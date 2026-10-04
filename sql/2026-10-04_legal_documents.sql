-- The terms of service and privacy policy, editable without an app release.
--
-- This repo has no migration runner: the schema lives in Supabase and this file
-- is the record of what was applied. Run it once in the Supabase SQL editor.
-- Re-running is safe: the seed rows are `on conflict do nothing`, so it never
-- overwrites a document that has since been edited.
--
-- Read through the public `GET /legal` (src/legal). The app keeps a bundled copy
-- (constants/legal) for the first launch offline; the seed below is generated
-- from that copy, so on the day this runs nothing changes for anyone.
--
-- Editing:
--   * `sections` is a JSON array of { heading, paragraphs?, bullets?,
--     paragraphsAfter?, rows?: [{ label, value }] } — the same shape the app
--     renders.
--   * Bump `version` (and `effective_date`) when the substance changes. Consent
--     is stored against the privacy policy version, so a bump sends every user
--     back through the consent screen on their next launch. Fixing a typo or
--     filling in a placeholder needs no bump.
--   * `contact_email` (privacy row) is where "Request my data" in Settings
--     writes to.

create table if not exists public.legal_documents (
  kind text primary key check (kind in ('terms', 'privacy')),
  version text not null,
  effective_date text not null,
  title text not null,
  intro text not null,
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  contact_email text,
  updated_at timestamptz not null default now()
);

-- No policies: nobody reads this table with their own token. The backend uses
-- the service role, which bypasses RLS; enabling it keeps the anon key out.
alter table public.legal_documents enable row level security;

create or replace function public.legal_documents_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists legal_documents_touch on public.legal_documents;
create trigger legal_documents_touch
  before update on public.legal_documents
  for each row execute function public.legal_documents_touch();

insert into public.legal_documents
  (kind, version, effective_date, title, intro, sections, contact_email)
values (
  'terms',
  $legal$1.0.0$legal$,
  $legal$[DOPLNIT: datum účinnosti]$legal$,
  $legal$Obchodní podmínky$legal$,
  $legal$Tyto podmínky upravují používání mobilní aplikace Athletica. Registrací účtu s nimi vyslovujete souhlas. Přečtěte si prosím zejména článek 7 o zdravotních rizicích.$legal$,
  $legal$[
  {
    "heading": "1. Provozovatel",
    "rows": [
      {
        "label": "Provozovatel",
        "value": "[DOPLNIT: jméno / obchodní firma provozovatele]"
      },
      {
        "label": "Sídlo",
        "value": "[DOPLNIT: sídlo / místo podnikání]"
      },
      {
        "label": "IČO",
        "value": "[DOPLNIT: IČO]"
      },
      {
        "label": "DIČ",
        "value": "[DOPLNIT: DIČ nebo „nejsme plátci DPH“]"
      },
      {
        "label": "E-mail",
        "value": "[DOPLNIT: kontaktní e-mail]"
      }
    ]
  },
  {
    "heading": "2. Co aplikace nabízí",
    "paragraphs": [
      "Athletica je nástroj pro zaznamenávání tréninků, stravy a tělesné kondice. Umožňuje také vyhledat trenéra, spojit se s ním, sdílet s ním své záznamy a komunikovat prostřednictvím chatu.",
      "Používání aplikace je bezplatné. Odměna za trenérské služby se sjednává přímo mezi vámi a trenérem mimo aplikaci."
    ]
  },
  {
    "heading": "3. Registrace a účet",
    "bullets": [
      "Účet si může založit pouze osoba starší 15 let. Tato hranice vychází z § 7 zákona č. 110/2019 Sb.",
      "Údaje uvedené při registraci musí být pravdivé; při jejich změně je aktualizujte.",
      "Přístupové údaje k účtu nesdělujte třetím osobám. Za činnost provedenou pod svým účtem odpovídáte.",
      "Účet můžete kdykoli a bez uvedení důvodu smazat přímo v aplikaci v sekci Profil. Smazáním zanikají i vaše záznamy."
    ]
  },
  {
    "heading": "4. Postavení provozovatele u trenérských služeb",
    "paragraphs": [
      "Provozovatel není poskytovatelem trenérských služeb a není smluvní stranou vztahu mezi vámi a trenérem. Aplikace pouze zprostředkovává kontakt a předání údajů.",
      "Smlouva o trenérských službách vzniká výhradně mezi klientem a trenérem. Za obsah tréninkového a stravovacího plánu, za jeho vhodnost pro konkrétní osobu a za způsob jeho vedení odpovídá trenér.",
      "Provozovatel neručí za kvalifikaci trenéra, za dostupnost jeho služeb ani za splnění toho, co si s vámi sjedná."
    ]
  },
  {
    "heading": "5. Povinnosti trenéra",
    "paragraphs": [
      "Registrací v roli trenéra potvrzujete, že:"
    ],
    "bullets": [
      "jste oprávněn poskytovat tělovýchovné a sportovní služby v souladu s právními předpisy — v České republice jde o vázanou živnost „Poskytování tělovýchovných a sportovních služeb v oblasti [obor]“;",
      "údaje klientů, které se vám zpřístupní, použijete výhradně k poskytnutí trenérské služby, zachováte o nich mlčenlivost a nepředáte je dalším osobám;",
      "ve vztahu k údajům klientů vystupujete jako samostatný správce a plníte vlastní povinnosti podle GDPR;",
      "nebudete klientům poskytovat rady, které přísluší lékaři, fyzioterapeutovi nebo nutričnímu terapeutovi."
    ],
    "paragraphsAfter": [
      "Tréninkové plány, tréninkové dny, upravené tréninky a stravovací plány včetně nutričních cílů, které trenér v aplikaci vytvoří, nejsou veřejné. Šablony a uložené plány vidí jen trenér, který je vytvořil. Plán přiřazený klientovi vidí jen tento klient a jeho trenér — ostatní klienti téhož trenéra ani další uživatelé k němu přístup nemají. Provozovatel k tomuto obsahu přistupuje jen v rozsahu nezbytném pro provoz aplikace, vyřízení nahlášeného obsahu nebo splnění právní povinnosti."
    ]
  },
  {
    "heading": "6. Hodnocení trenérů",
    "paragraphs": [
      "Hodnocení a recenzi může vložit pouze uživatel, který je s daným trenérem v aplikaci propojen; aplikace to ověřuje při každém vložení. Jiné recenze nezveřejňujeme a hodnocení za odměnu nepřijímáme.",
      "Pořadí trenérů ve výsledcích vyhledávání se řídí zadanými filtry (cena, lokalita, zaměření), průměrným hodnocením a počtem recenzí. Placené zvýhodnění pozice neposkytujeme."
    ]
  },
  {
    "heading": "7. Zdravotní upozornění — přečtěte si prosím pozorně",
    "paragraphs": [
      "Athletica není zdravotnickým prostředkem. Neslouží ke stanovení diagnózy, k léčbě, ke zmírnění ani k prevenci onemocnění. Obsah aplikace ani doporučené hodnoty příjmu energie a živin nenahrazují odbornou lékařskou, fyzioterapeutickou ani nutriční péči.",
      "Před zahájením tréninkového nebo stravovacího programu se poraďte s lékařem, zejména pokud jste těhotná, máte onemocnění srdce či pohybového aparátu, poruchu příjmu potravy, diabetes nebo jiné chronické onemocnění, případně pokud užíváte léky.",
      "Fyzická zátěž s sebou nese riziko úrazu. Cvičte v rozsahu svých možností a činnost ukončete, pocítíte-li bolest, závrať či nevolnost.",
      "Provozovatel neodpovídá za újmu vzniklou nesprávným provedením cviku, přeceněním vlastních sil ani nedodržením pokynů trenéra. Tím není dotčena odpovědnost za újmu na zdraví v rozsahu, v jakém ji podle § 2898 občanského zákoníku nelze předem vyloučit ani omezit."
    ]
  },
  {
    "heading": "8. Pravidla pro obsah uživatelů",
    "paragraphs": [
      "Do aplikace nesmíte vkládat obsah, který:"
    ],
    "bullets": [
      "porušuje právní předpisy nebo práva třetích osob včetně práv autorských;",
      "je urážlivý, výhrůžný, nenávistný nebo obtěžující;",
      "má sexuální povahu nebo zobrazuje nezletilé nevhodným způsobem;",
      "propaguje nebezpečné hubnutí, poruchy příjmu potravy nebo zneužívání látek včetně anabolických steroidů;",
      "je nevyžádaným obchodním sdělením nebo klamavou reklamou."
    ]
  },
  {
    "heading": "9. Nahlášení závadného obsahu",
    "paragraphs": [
      "Domníváte-li se, že obsah v aplikaci je nezákonný nebo porušuje tyto podmínky, nahlaste jej v aplikaci — odkazem „Nahlásit tento profil“ na profilu trenéra, ikonou vlajky u recenze nebo podržením prstu na zprávě v chatu — případně nám napište na [DOPLNIT: kontaktní e-mail]. Uveďte, co je na obsahu podle vás nezákonné nebo v rozporu s podmínkami.",
      "Každé oznámení posoudíme bez zbytečného odkladu, o výsledku vás vyrozumíme a rozhodnutí odůvodníme. Postupujeme podle čl. 16 nařízení (EU) 2022/2065 o digitálních službách.",
      "Proti našemu rozhodnutí o odstranění obsahu nebo omezení účtu se můžete odvolat na tutéž adresu."
    ]
  },
  {
    "heading": "10. Omezení a zrušení účtu",
    "paragraphs": [
      "Poruší-li uživatel tyto podmínky závažně nebo opakovaně, můžeme obsah odstranit, omezit funkce účtu nebo účet zrušit. O důvodu vás vyrozumíme, nebrání-li tomu právní povinnost.",
      "Aplikaci můžeme kdykoli změnit nebo její provoz ukončit. O ukončení provozu vás vyrozumíme alespoň 30 dnů předem, abyste si stihli stáhnout svá data."
    ]
  },
  {
    "heading": "11. Odpovědnost provozovatele",
    "paragraphs": [
      "Aplikace je poskytována bezplatně a bez záruky nepřetržité dostupnosti. Neodpovídáme za výpadky způsobené třetími stranami, poruchou vašeho zařízení ani zásahem vyšší moci.",
      "Neodpovídáme za ztrátu dat způsobenou odinstalací aplikace, smazáním účtu ani jednáním třetí osoby. Doporučujeme si důležité záznamy zálohovat exportem.",
      "Žádné ustanovení těchto podmínek neomezuje práva spotřebitele, která nelze podle právních předpisů vyloučit — zejména odpovědnost za újmu na zdraví a za újmu způsobenou úmyslně nebo z hrubé nedbalosti."
    ]
  },
  {
    "heading": "12. Změny podmínek",
    "paragraphs": [
      "Podmínky můžeme měnit. O změně vás vyrozumíme v aplikaci nejméně 15 dnů před nabytím účinnosti. Pokračujete-li po tomto dni v používání aplikace, platí, že se změnou souhlasíte. Nesouhlasíte-li, můžete účet do té doby bezplatně smazat."
    ]
  },
  {
    "heading": "13. Rozhodné právo a řešení sporů",
    "paragraphs": [
      "Vztahy se řídí právním řádem České republiky, zejména zákonem č. 89/2012 Sb., občanským zákoníkem, a zákonem č. 634/1992 Sb., o ochraně spotřebitele. Tím nejsou dotčena práva spotřebitele podle právních předpisů státu jeho obvyklého bydliště.",
      "Spotřebitel má právo na mimosoudní řešení spotřebitelského sporu. K tomu je věcně příslušná Česká obchodní inspekce, Štěpánská 44, 110 00 Praha 1, https://adr.coi.cz."
    ]
  },
  {
    "heading": "14. Měsíční výzva a slosování o ceny",
    "paragraphs": [
      "Každý kalendářní měsíc (poprvé za říjen 2026) slosováváme mezi uživateli, kteří pravidelně trénují, ceny od našich partnerů. Pravidla:"
    ],
    "bullets": [
      "Účast je bezplatná a automatická; nic nekupujete ani nesázíte. Nejde o hazardní hru podle zákona č. 186/2016 Sb.",
      "Do slosování se dostanete, pokud za měsíc zaznamenáte trénink alespoň v 10 různých dnech. Každý den s tréninkem je jeden los, den s tréninkem i zapsaným jídlem dva losy.",
      "Po skončení měsíce vylosujeme tolik výherců, kolik je pro daný měsíc připraveno cen. Výsledek se určí jednou a lze jej zpětně ověřit; nelze jej ovlivnit ani změnit.",
      "Výhru uvidíte v aplikaci jako slevový nebo dárkový kód. Cenu nelze vyměnit za peníze. Za plnění ceny odpovídá partner, který ji poskytl.",
      "Záznamy zjevně neodpovídající skutečnosti (například hromadné zpětné zapisování tréninků) můžeme ze slosování vyřadit.",
      "Slosování můžeme změnit nebo ukončit; již vylosované výhry tím nejsou dotčeny.",
      "[DOPLNIT: rozhodnout, zda se slosování účastní i trenéři — dnes ano. Pokud by hodnota jedné výhry přesáhla 10 000 Kč, podléhá u výherce srážkové dani podle § 36 zákona č. 586/1992 Sb.]"
    ]
  },
  {
    "heading": "15. Kontakt",
    "paragraphs": [
      "S jakýmkoli dotazem se na nás obraťte na [DOPLNIT: kontaktní e-mail]."
    ]
  }
]$legal$::jsonb,
  null
)
on conflict (kind) do nothing;

insert into public.legal_documents
  (kind, version, effective_date, title, intro, sections, contact_email)
values (
  'privacy',
  $legal$1.0.0$legal$,
  $legal$[DOPLNIT: datum účinnosti]$legal$,
  $legal$Zásady ochrany osobních údajů$legal$,
  $legal$Tyto zásady popisují, jaké osobní údaje aplikace Athletica zpracovává, proč, na jakém právním základě, komu je předává a jaká máte práva. Zpracování se řídí nařízením (EU) 2016/679 (GDPR) a zákonem č. 110/2019 Sb., o zpracování osobních údajů.$legal$,
  $legal$[
  {
    "heading": "1. Kdo je správce",
    "paragraphs": [
      "Správcem osobních údajů je provozovatel aplikace Athletica:"
    ],
    "rows": [
      {
        "label": "Provozovatel",
        "value": "[DOPLNIT: jméno / obchodní firma provozovatele]"
      },
      {
        "label": "Sídlo",
        "value": "[DOPLNIT: sídlo / místo podnikání]"
      },
      {
        "label": "IČO",
        "value": "[DOPLNIT: IČO]"
      },
      {
        "label": "E-mail",
        "value": "[DOPLNIT: e-mail pro žádosti k osobním údajům]"
      }
    ]
  },
  {
    "heading": "2. Jaké údaje zpracováváme",
    "paragraphs": [
      "Zpracováváme pouze údaje, které nám sami zadáte nebo které vzniknou vaším používáním aplikace:"
    ],
    "bullets": [
      "Identifikační a kontaktní údaje: e-mail, jméno a příjmení, uživatelská role (klient / trenér), datum narození.",
      "Údaje o zdravotním stavu a tělesné kondici: pohlaví, výška, hmotnost a její vývoj v čase, cíl (hubnutí / udržení / nabírání), úroveň aktivity, stravovací režim.",
      "Záznamy o tréninku: provedené cviky, série, opakování, zátěž, doba odpočinku, historie tréninků.",
      "Záznamy o stravování: zaznamenaná jídla, energetická a nutriční hodnota, fotografie jídel.",
      "Fotografie postavy a profilové fotografie, které nahrajete.",
      "Kardio tréninky, které si sami převezmete z Apple Zdraví nebo Health Connect: druh aktivity, začátek, délka a vzdálenost. Nic jiného ze zdravotních aplikací nečteme a nic do nich nezapisujeme.",
      "Obsah komunikace s trenérem v chatu aplikace včetně fotografií, které se automaticky mažou po 7 dnech.",
      "Schůzky s trenérem: termín, druh služby, místo a stav (žádost, potvrzení, zrušení).",
      "Účast v měsíčním žebříčku a v měsíčním slosování o ceny, včetně vyhraných slevových kódů.",
      "Skóre rizika ukončení spolupráce, které pro vašeho trenéra počítáme z vašich záznamů (viz článek 14).",
      "Nahlášení obsahu, která podáte, a jejich vyřízení.",
      "Hodnocení a recenze, které napíšete trenérovi.",
      "Technické údaje: identifikátor zařízení pro doručování oznámení (push token), platforma zařízení, provozní a chybové záznamy."
    ]
  },
  {
    "heading": "3. Údaje o zdravotním stavu — zvláštní kategorie",
    "paragraphs": [
      "Údaje o vaší hmotnosti, tělesných mírách, fotografiích postavy, stravování a tréninkové zátěži jsou podle čl. 9 GDPR údaji o zdravotním stavu, tedy zvláštní kategorií osobních údajů se zvýšenou ochranou.",
      "Tyto údaje zpracováváme výhradně na základě vašeho výslovného souhlasu podle čl. 9 odst. 2 písm. a) GDPR. Souhlas udělujete samostatně při registraci a můžete jej kdykoli odvolat v aplikaci v sekci Nastavení → Soukromí a souhlasy. Bez tohoto souhlasu nelze aplikaci používat, protože sledování kondice je její jedinou funkcí.",
      "Odvolání souhlasu nemá vliv na zákonnost zpracování před jeho odvoláním."
    ]
  },
  {
    "heading": "4. Účely zpracování a právní základy",
    "rows": [
      {
        "label": "Vedení uživatelského účtu, přihlášení, ověření e-mailu",
        "value": "Plnění smlouvy — čl. 6 odst. 1 písm. b) GDPR. Údaje jsou nezbytné, bez nich účet nelze vést."
      },
      {
        "label": "Sledování kondice: tréninky, strava, hmotnost, fotografie postavy",
        "value": "Výslovný souhlas — čl. 9 odst. 2 písm. a) GDPR (zvláštní kategorie údajů)."
      },
      {
        "label": "Zpřístupnění vašich údajů trenérovi, kterého si vyberete",
        "value": "Výslovný souhlas — čl. 9 odst. 2 písm. a) GDPR. Uděluje se samostatně a lze jej odvolat odpojením od trenéra."
      },
      {
        "label": "Odhad nutričních hodnot jídla z fotografie pomocí umělé inteligence",
        "value": "Výslovný souhlas — čl. 9 odst. 2 písm. a) GDPR (součást souhlasu se zpracováním údajů o zdraví). Fotografii zpracovává Google jako náš zpracovatel, viz článek 7."
      },
      {
        "label": "Převzetí kardio tréninků z Apple Zdraví / Health Connect",
        "value": "Výslovný souhlas — čl. 9 odst. 2 písm. a) GDPR a vaše povolení v nastavení telefonu, které lze kdykoli odebrat."
      },
      {
        "label": "Skóre rizika ukončení spolupráce a doporučení pro trenéra",
        "value": "Výslovný souhlas se sdílením s trenérem — čl. 9 odst. 2 písm. a) GDPR. Počítá se jen z údajů, které trenérovi zpřístupňujete."
      },
      {
        "label": "Zobrazení v měsíčním žebříčku ostatním klientům trenéra",
        "value": "Samostatný výslovný souhlas — čl. 9 odst. 2 písm. a) GDPR. Ve výchozím stavu vypnuto."
      },
      {
        "label": "Měsíční slosování o ceny a předání výhry",
        "value": "Plnění smlouvy — čl. 6 odst. 1 písm. b) GDPR, podle pravidel v obchodních podmínkách."
      },
      {
        "label": "Sjednávání schůzek s trenérem",
        "value": "Plnění smlouvy — čl. 6 odst. 1 písm. b) GDPR."
      },
      {
        "label": "Vyřizování nahlášeného obsahu",
        "value": "Právní povinnost — čl. 6 odst. 1 písm. c) GDPR ve spojení s čl. 16 a 17 nařízení (EU) 2022/2065 o digitálních službách."
      },
      {
        "label": "Provozní oznámení (potvrzení, zpráva od trenéra, připomínky)",
        "value": "Plnění smlouvy — čl. 6 odst. 1 písm. b) GDPR. Doručování lze vypnout v nastavení zařízení."
      },
      {
        "label": "Marketingová sdělení a tipy",
        "value": "Souhlas — čl. 6 odst. 1 písm. a) GDPR. Ve výchozím stavu vypnuto."
      },
      {
        "label": "Statistiky používání aplikace a diagnostika chyb",
        "value": "Souhlas — čl. 6 odst. 1 písm. a) GDPR. Ve výchozím stavu vypnuto."
      },
      {
        "label": "Zabezpečení, prevence zneužití, omezení počtu pokusů o přihlášení",
        "value": "Oprávněný zájem na bezpečnosti služby — čl. 6 odst. 1 písm. f) GDPR."
      }
    ]
  },
  {
    "heading": "5. Sdílení údajů s trenérem",
    "paragraphs": [
      "Pokud se v aplikaci spojíte s trenérem, můžete mu zpřístupnit údaje, které potřebuje k sestavení a vedení vašeho plánu. Rozsah určujete vy, a to zvlášť pro každou ze tří skupin:"
    ],
    "bullets": [
      "Tréninky — provedené série, cviky, opakování a zátěž.",
      "Jídlo — zaznamenaná jídla a denní energetická a nutriční bilance.",
      "Tělesné údaje — vývoj hmotnosti, výška, věk, BMI, cíl a úroveň aktivity."
    ],
    "paragraphsAfter": [
      "Fotografie postavy trenérovi nezpřístupňujeme; zůstávají viditelné pouze vám.",
      "Trenér je ve vztahu k předaným údajům samostatným správcem a odpovídá za to, jak s nimi nakládá. Je smluvně vázán mlčenlivostí a povinností použít údaje výhradně k poskytnutí trenérské služby.",
      "Trenér vidí také skóre rizika, že spolupráci ukončíte, s krátkým vysvětlením a návrhem zprávy. Skóre počítáme jen z údajů, které mu zpřístupňujete: bez sdílení tréninků se nepočítá vůbec, bez sdílení jídla nebo tělesných údajů se tyto údaje do skóre nezapočítávají.",
      "Měsíční žebříček je oddělená věc: pokud k tomu dáte samostatný souhlas, uvidí vaše jméno, počet tréninků a nejdelší série v tréninku a zapisování jídla i ostatní klienti téhož trenéra. Bez souhlasu na žebříčku nejste.",
      "Sdílení začíná až okamžikem, kdy se s konkrétním trenérem spojíte, a končí vypnutím příslušné volby nebo odpojením. Poté trenér ztrácí přístup i k historickým záznamům. Nastavení najdete v aplikaci v sekci Profil → Soukromí a souhlasy."
    ]
  },
  {
    "heading": "6. Příjemci a zpracovatelé",
    "paragraphs": [
      "Osobní údaje nepředáváme nikomu k jejich vlastním účelům a neprodáváme je. Využíváme však následující zpracovatele, kteří pro nás zajišťují technický provoz a jsou vázáni smlouvou o zpracování osobních údajů podle čl. 28 GDPR:"
    ],
    "bullets": [
      "Supabase — autentizace uživatelů, databáze a úložiště nahraných fotografií.",
      "Roští.cz — hosting aplikačního serveru v České republice [DOPLNIT: obchodní firma a sídlo provozovatele Roští.cz].",
      "Google (Gemini API, Google LLC / Google Ireland Ltd.) — odhad nutričních hodnot z fotografie jídla, skóre rizika a doporučení pro trenéra, návrh tréninkového programu pro trenéra.",
      "Expo (Expo Application Services) — doručování push oznámení a distribuce aktualizací aplikace.",
      "Google (Firebase Cloud Messaging) — doručování push oznámení na zařízení s Androidem.",
      "Apple — doručování push oznámení na zařízení s iOS."
    ],
    "paragraphsAfter": [
      "Přihlášení přes Apple nebo Google: pokud se rozhodnete přihlásit účtem Apple nebo Google, ověří vaši totožnost daná společnost (Apple Inc. / Apple Distribution International Ltd., resp. Google LLC / Google Ireland Ltd.) jako samostatný správce podle svých zásad ochrany soukromí. My od ní obdržíme jen identifikátor účtu a e-mailovou adresu, u Apple při prvním přihlášení i jméno. Apple vám může nabídnout skrytí e-mailu — pak dostaneme jen přeposílací adresu. Žádné údaje o vašem používání aplikace těmto společnostem neposíláme."
    ]
  },
  {
    "heading": "7. Vyhledávání potravin a umělá inteligence",
    "paragraphs": [
      "Při vyhledávání potraviny odesíláme zadaný text do veřejných databází Open Food Facts a Kalorické tabulky, abychom získali nutriční hodnoty. Neodesíláme s dotazem vaše jméno, e-mail ani identifikátor účtu — dotaz nelze na jeho straně spojit s vaší osobou.",
      "Některé funkce využívají model umělé inteligence Gemini od společnosti Google: odhad nutričních hodnot z fotografie jídla, návrh tréninkového programu, který si trenér nechá připravit, a slovní doporučení k skóre rizika pro trenéra. Modelu posíláme jen to, co daná funkce potřebuje (fotografii jídla; zadání trenéra; souhrnná čísla o aktivitě a křestní jméno klienta), nikoli váš e-mail ani identifikátor účtu.",
      "Google údaje zpracovává jako náš zpracovatel, nepoužívá je k trénování svých modelů a po zpracování požadavku je neuchovává déle, než vyžadují jeho podmínky pro placené služby. Výstupy umělé inteligence jsou jen odhad nebo návrh a může v nich být chyba — o tom, co s nimi udělá, rozhoduje uživatel nebo trenér, ne model.",
      "[DOPLNIT: ověřit, že je Gemini API používáno v placeném režimu (Paid Services). Bezplatný režim Google smí data používat ke zlepšování služeb a pro uživatele z EHP se nesmí používat.]"
    ]
  },
  {
    "heading": "8. Předávání mimo EU/EHP",
    "paragraphs": [
      "Někteří naši zpracovatelé mohou údaje zpracovávat mimo Evropský hospodářský prostor, zejména ve Spojených státech (doručování push oznámení, zpracování umělou inteligencí Gemini).",
      "Takové předání se uskutečňuje na základě standardních smluvních doložek schválených Evropskou komisí, případně na základě rozhodnutí o odpovídající ochraně (EU–US Data Privacy Framework), pokud je příjemce certifikován.",
      "[DOPLNIT: potvrdit region databáze Supabase. Pokud je projekt hostován mimo EU, je nutné to zde výslovně uvést, protože jde o předání údajů o zdravotním stavu.]"
    ]
  },
  {
    "heading": "9. Jak dlouho údaje uchováváme",
    "rows": [
      {
        "label": "Údaje účtu a záznamy o kondici",
        "value": "Po dobu trvání účtu. Po smazání účtu jsou nevratně odstraněny."
      },
      {
        "label": "Fotografie postavy a jídel",
        "value": "Po dobu trvání účtu, nebo do jejich dřívějšího smazání v aplikaci."
      },
      {
        "label": "Fotografie v chatu",
        "value": "7 dní od odeslání, poté se automaticky smažou."
      },
      {
        "label": "Skóre rizika ukončení spolupráce",
        "value": "Po dobu spojení s trenérem; přepočítává se denně. Smaže se odpojením, zrušením sdílení tréninků nebo smazáním účtu."
      },
      {
        "label": "Nahlášení obsahu",
        "value": "3 roky od vyřízení, abychom mohli doložit, jak jsme s oznámením naložili. Po smazání vašeho účtu u nahlášení nezůstane vaše jméno ani identifikátor."
      },
      {
        "label": "Komunikace s trenérem",
        "value": "Po dobu trvání účtu; po smazání účtu je odstraněna z pohledu obou stran."
      },
      {
        "label": "Doklad o udělení a odvolání souhlasu",
        "value": "3 roky od zániku účtu — abychom byli schopni doložit soulad podle čl. 7 odst. 1 GDPR."
      },
      {
        "label": "Provozní a bezpečnostní záznamy",
        "value": "Nejdéle 12 měsíců."
      }
    ]
  },
  {
    "heading": "10. Vaše práva",
    "paragraphs": [
      "Ve vztahu ke svým osobním údajům máte tato práva:"
    ],
    "bullets": [
      "Právo na přístup (čl. 15) — zjistit, jaké údaje o vás zpracováváme, a získat jejich kopii; kopii si můžete stáhnout i sami v aplikaci.",
      "Právo na opravu (čl. 16) — nechat opravit nepřesné údaje; většinu si můžete upravit přímo v profilu.",
      "Právo na výmaz (čl. 17) — smazat účet i s údaji, přímo v aplikaci v sekci Profil.",
      "Právo na omezení zpracování (čl. 18).",
      "Právo na přenositelnost (čl. 20) — získat své záznamy ve strojově čitelném formátu (JSON), přímo v aplikaci v sekci Nastavení → Soukromí a souhlasy → Stáhnout moje data.",
      "Právo vznést námitku proti zpracování založenému na oprávněném zájmu (čl. 21).",
      "Právo kdykoli odvolat souhlas (čl. 7 odst. 3), aniž je tím dotčena zákonnost dřívějšího zpracování.",
      "Právo podat stížnost u dozorového úřadu."
    ]
  },
  {
    "heading": "11. Jak práva uplatnit",
    "paragraphs": [
      "Napište nám na [DOPLNIT: e-mail pro žádosti k osobním údajům]. Odpovíme nejpozději do jednoho měsíce od doručení žádosti; ve složitých případech lze lhůtu prodloužit o další dva měsíce, o čemž vás vyrozumíme.",
      "Nejste-li s vyřízením spokojeni, můžete se obrátit na Úřad pro ochranu osobních údajů, Pplk. Sochora 27, 170 00 Praha 7, https://www.uoou.cz."
    ]
  },
  {
    "heading": "12. Věková hranice",
    "paragraphs": [
      "Aplikace je určena osobám od 15 let. Tato hranice odpovídá § 7 zákona č. 110/2019 Sb., podle kterého může dítě samo udělit souhlas se zpracováním údajů v souvislosti se službou informační společnosti od 15 let věku.",
      "Účty osob mladších 15 let nezakládáme. Zjistíme-li, že účet přesto vznikl, bez zbytečného odkladu jej i s údaji smažeme."
    ]
  },
  {
    "heading": "13. Zabezpečení",
    "paragraphs": [
      "Přenos mezi aplikací a servery je šifrován (HTTPS/TLS). Přihlašovací tokeny jsou v zařízení uloženy v zabezpečeném úložišti operačního systému. Přístup k údajům v databázi je omezen pravidly na úrovni řádků tak, aby uživatel viděl pouze svá data a trenér pouze data klientů, kteří mu k tomu dali souhlas.",
      "Dojde-li k porušení zabezpečení s rizikem pro vaše práva, ohlásíme je dozorovému úřadu do 72 hodin a při vysokém riziku vyrozumíme i vás."
    ]
  },
  {
    "heading": "14. Automatizované rozhodování a profilování",
    "paragraphs": [
      "Doporučené hodnoty příjmu energie a živin počítáme z údajů, které zadáte (výška, hmotnost, věk, pohlaví, aktivita, cíl). Jde o orientační výpočet, nikoli o automatizované rozhodování s právními účinky ve smyslu čl. 22 GDPR. Výsledek nenahrazuje odborné lékařské ani výživové doporučení.",
      "Pro trenéra, se kterým jste spojeni, počítáme skóre rizika, že spolupráci ukončíte. Vychází z toho, jak pravidelně trénujete ve srovnání s vaším plánem, zda zapisujete jídlo a vážíte se, kdy jste naposledy psali trenérovi a zda rušíte schůzky. Jde o profilování, na jehož základě ale nerozhoduje stroj: trenér se podle něj jen může rozhodnout, zda se vám ozve. Nemá pro vás právní ani obdobně závažné účinky ve smyslu čl. 22 GDPR.",
      "Profilování můžete zastavit vypnutím sdílení tréninků s trenérem nebo odvoláním souhlasu se sdílením. Své skóre najdete v exportu údajů."
    ]
  },
  {
    "heading": "15. Změny těchto zásad",
    "paragraphs": [
      "Zásady můžeme aktualizovat. O podstatné změně vás vyrozumíme v aplikaci a — mění-li se rozsah zpracování založeného na souhlasu — vyžádáme si souhlas znovu. Aktuální verze je vždy dostupná v aplikaci a na našem webu."
    ]
  }
]$legal$::jsonb,
  $legal$[DOPLNIT: e-mail pro žádosti k osobním údajům]$legal$
)
on conflict (kind) do nothing;
