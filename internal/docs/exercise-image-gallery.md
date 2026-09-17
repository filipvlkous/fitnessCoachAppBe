# Dva obrázky u cviku

Cvik měl jeden demonstrační obrázek. Teď má dva sloty a klient mezi nimi
v loggeru přejíždí prstem — typicky začátek a konec pohybu, nebo správné
a špatné provedení.

## Schéma

`public.exercises` má vedle `img_url` nový sloupec **`img_url_2`**
(`sql/2026-09-15_exercise_img_url_2.sql`, idempotentní). Obojí je veřejná
URL objektu v bucketu `images`, zapsaná `uploadMedia` po překódování do WebP.

**Sloty jsou nezávislé.** Kterýkoli může být prázdný, když druhý není.
Smazání prvního druhý **nepřesouvá** — zůstane, kde ho trenér nechal,
a appka si galerii poskládá z toho, co je vyplněné. Proto se v UI všude
filtruje (`.filter(Boolean)`) a nikdy neindexuje: cvik, kterému trenér
odebral první fotku, je jednoobrázková galerie, ne prázdná stránka a za ní
jedna.

### Proč dva sloupce a ne pole nebo vedlejší tabulka

Galerie jsou přesně dva obrázky, protože to tak rozhoduje UI: trenér má
v editoru dva sloty. `text[]` nebo `exercise_images` by modelovaly neomezený
seznam, který nikdo nechtěl, a všechny stávající cesty — `parseStorageLocation`,
úklid v `remove`, mazání po slotech — už umí jednu URL po druhé. Až galerie
poroste, je čas to normalizovat — ne dřív.

## API

| endpoint | co se změnilo |
|---|---|
| `GET /exercises/:id/media` | `img_url_2` chodí u `type=image` i `type=both` — oba obrázky jsou jedna galerie |
| `POST /exercises/:exerciseId/upload-media` | nové pole `image2`; poslat jde jedno, druhé nebo obojí |
| `DELETE /exercises/:id/media?type=…` | nová hodnota `image2`; `image` maže jen první, `both` maže obojí i video |

Upload **zapisuje jen pole, která dorazila**. Slot, kterého se trenér nedotkl,
se do requestu vůbec nepošle, a tím zůstane, jak byl. Appka to hlídá
v `handleSave` (`hasNewImage` / `hasNewImage2`).

Název souboru v storage dostal náhodný ocásek vedle timestampu
(`image-<ts>-<rnd>.webp`). Jeden request teď může nést oba obrázky a dva
uploady ve stejné milisekundě by jinak trefily stejnou cestu — což
`upsert: false` neudělá jako přepis, ale jako spadlé uložení.

## Překrytí trenérovou verzí

`exercise_coach_versions` **druhý sloupec nedostává** a nedostane. Trenérova
soukromá verze má jeden obrázkový slot, a `resolveExerciseForViewer` bere
jeho fotku jako **náhradu celé galerie**, ne jako její první stránku:

```
katalog:  obrázek A | obrázek B
verze:    obrázek C
------------------------------
klient:   obrázek C            ← ne „C, pak B“
```

Kdyby se míchaly, klient by z trenérovy fotky přejel na katalogovou, kterou
si trenér nevybral a nemůže ji odebrat. Pravidlo je v
`src/exercises/exercise-version.ts` a drží ho dva testy v
`exercise-version.spec.ts`.

Trenér, který vlastní obrázek nemá, propouští obě katalogové fotky beze změny.

## Odkud se to kreslí

`components/Exercise/ExerciseImageCarousel.tsx` — jedna komponenta pro obě
obrazovky. Bere `uris: string[]`, už vyfiltrované.

- **Jeden obrázek není galerie**: žádný scroller, žádné tečky.
- Animaci dělá `ScrollView` s `pagingEnabled` — tah, dojezd i zacvaknutí
  řeší nativní scroller. Reanimated pager by přidal vlastní stav gesta, který
  se může rozejít s tím, co je na obrazovce, a výsledek by byl stejný.
- **Sama se posouvá každých 0,5 s** (`AUTO_ADVANCE_MS`) na další fotku, po
  poslední zpátky na první. Dvě fotky bývají začátek a konec pohybu, takže
  střídání čte jako pohyb sám. Timer se natahuje znovu při každé změně stránky
  (swipe dá vybrané fotce celou půlvteřinu) a během tažení prstem stojí — jinak
  by stránku odsunul zpod prstu. Posun je jen `scrollTo`, animaci dělá pořád
  nativní scroller.
- Šířka stránky je **naměřená** (`onLayout`), ne šířka okna: komponenta sedí
  v kartě s vlastním paddingem. Rámeček má pevnou výšku, aby během měření
  neskočil.
- `directionalLockEnabled`, protože obě obrazovky pod tím scrollují svisle.
- Stylesheet smí být na úrovni modulu, protože nepoužívá akcentní barvy —
  viz poznámka v `workoutLoggerStyles.ts` o tom, že `StyleSheet.create`
  zkopíruje paletu platnou při prvním renderu.

### Trenérova obrazovka cviku

V **náhledu** vidí trenér tutéž galerii co klient. V **editaci** se sloty
rozloží pod sebe, každý s vlastním křížkem — trenér musí vidět, kterou fotku
mu tlačítko „Vyměnit 2. obrázek“ přepíše. Tlačítka na obrázky sdílí jeden
řádek, video má vlastní: tři vedle sebe se na úzkém telefonu nevejdou
i s popiskem.

Zakládací formulář v seznamu cviků nabízí pořád jen jeden obrázek. Druhý se
přidává až na obrazovce cviku.
