# Trenérova vlastní verze cviku

Katalog cviků (`public.exercises`) je sdílený a smí ho měnit kterýkoli trenér.
Kdo chtěl cvik naučit po svém, musel přepsat text kolegovi. Tahle funkce dává
každému trenérovi vlastní vrstvu: **jeho text, jeho obrázek, jeho YouTube
odkaz**, které čte jen on a jeho schválení klienti.

## Pravidlo

Vrstva **nikdy nenahrazuje celý cvik**, překrývá se po polích. Null ve verzi
znamená „nemám názor“ a platí katalog. Trenér, který napsal jen poznámku, tím
neschová obrázek, který jeho klient používal včera.

```
katalog:  text A | obrázek A | yt A | klip A
verze:    text B |     -     |  -   |  (nelze)
--------------------------------------------
klient:   text B | obrázek A | yt A | klip A
```

Pravidlo je vytažené do `src/exercises/exercise-version.ts`
(`resolveExerciseForViewer`) a pokryté testy v `exercise-version.spec.ts`.
Je to celá funkce na pět řádků a jediné, co nesmí odjet.

**Nahrané krátké video (`video_url`) přebít nejde.** Je to objekt v Supabase
Storage s vlastním úklidem, s cache v telefonu klíčovanou URL a se stropem
100 MB na soubor. Duplikovat ho per trenér znamená násobit úložiště u pole,
které trenéři přetáčejí nejmíň. Kdo chce vlastní záběr, dá ho jako `youtube_url`.

## Kdo co vidí

`GET /exercises/:id/media` vrací obsah **už vyřešený pro toho, kdo se ptá**:
katalog s verzí jeho trenéra navrchu. Dva klienti různých trenérů dostanou
z téže URL různý obsah. Cachovat to jde jen proto, že
`UserScopedCacheInterceptor` klíčuje každý záznam žadatelem.

Trenér z `/media` dostává **katalog, nikdy svoji verzi**. Je to schválně:
stejný endpoint plní na obrazovce cviku editor, který zapisuje zpátky do
sdíleného katalogu. Kdyby dostal překrytý obrázek, další uložení by jeho
soukromou fotku zkopírovalo do katalogu, který čtou všichni. Svoji verzi vidí
trenér v samostatné kartě přes `GET /exercises/:id/coach-version`.

„Můj trenér“ = jedna schválená relace v `coach_user_relations`
(`status = 'approved'`, `limit 1`), stejně jako všude jinde v kódu — aplikace
modeluje jednoho trenéra na klienta a session nese jediné `coachId`.

## Endpointy

| Metoda | Cesta | Kdo |
|---|---|---|
| `GET` | `/exercises/:id/media?type=` | kdokoli přihlášený (vyřešeno pro něj) |
| `GET` | `/exercises/:id/coach-version` | trenér, svoji verzi |
| `PUT` | `/exercises/:id/coach-version` | trenér, text + odkaz |
| `POST` | `/exercises/:id/coach-version/image` | trenér, obrázek |
| `DELETE` | `/exercises/:id/coach-version?part=image\|all` | trenér |

`PUT` drží stejnou tříhodnotovou konvenci jako katalog: klíč vynechaný =
nesahat, `''` = smazat zpátky na katalog, text = přebít. Obrázek jde vlastním
endpointem, protože je to soubor; upsert ho čte z DB a nese dál, takže uložení
textu ho neshodí.

## Cache

`UserScopedCacheInterceptor` ukládá pod `user:<id>:<originalUrl>` na pět minut.
Každý zápis verze proto maže jeden záznam **na čtenáře a na variantu `?type=`** —
každý schválený klient krát čtyři cesty (`''`, `?type=image`, `?type=video`,
`?type=both`). Viz `ExercisesController.invalidateMediaCache`.

> Stávající `cacheManager.del('/exercises/:id/media')` u katalogových zápisů
> nemaže nic — klíč nemá ani prefix `user:`, ani `?type=`. S touhle funkcí to
> nesouvisí a zůstalo to nedotčené, ale stojí za opravu.

## Úložiště

Obrázky verzí leží ve stejném bucketu `images` jako katalogové, pod jménem
`coach-version-<coachId>-<timestamp>.webp`, komprimované stejným `sharp`
pipeline (WebP 80 %). Aplikace mezi nimi nepozná rozdíl a nemá proč.

Úklid: výměna obrázku maže ten starý **až po** přepsání řádku (opačné pořadí by
při selhání uploadu nechalo živý řádek ukazovat do prázdna). Smazání cviku
posbírá i obrázky všech verzí — řádky odejdou přes foreign key, soubory ne.

## Kde to je

- BE: `src/exercises/` (`exercise-version.ts`, service, controller, dto),
  `src/auth/access.service.ts` (`getApprovedClientIds`)
- SQL: `sql/2026-09-12_exercise_coach_versions.sql`
- FE trenér: `components/Coach/Exercise/CoachVersionCard.tsx` v
  `app/coach/exercise/[exercise].tsx`
- FE klient: `components/User/WorkoutLogger/useExerciseMedia.ts` a
  `ExerciseHeaderCard.tsx`
- i18n: klíč `coachExerciseVersion` v `lib/i18n/cs.ts` a `en.ts`
