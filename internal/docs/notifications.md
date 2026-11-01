# Push notifikace

Všechno jde přes `NotificationsService.notifyUser()` (Expo, fire-and-forget, nikdy nehází).
Pravidlo: neposílat notifikaci tomu, kdo akci sám udělal.

| Akce | Příjemce | Kde |
|---|---|---|
| Kouč přiřadí plán / preset | klient | `coach-plans.service.ts` |
| Kouč vytvoří program (`POST /programs`) | klient | `programs.controller.ts` |
| Změna dne nebo cviků programu (create/update/delete day, add/update/bulk update/delete exercise) | atlet | `programs.controller.ts` (`notifyAthleteOfDayChange`, u add exercise inline) |
| Dokončený workout | kouč | `programs.service.ts` `completeWorkout` |
| Komentář k workoutu | druhá strana logu | `programs.service.ts` `addWorkoutComment` |
| Kouč změní makra | klient | `macros.service.ts` |
| Kouč přidá suplement | klient | `supplements.controller.ts` |
| Klient požádá o kouče | kouč | `user.service.ts` `assignUserToCoach` |
| Kouč schválí / zamítne žádost | klient | `user.service.ts` `approveUser` / `rejectUser` |
| Zrušení vztahu kouč–klient | druhá strana (klient odchází → všichni jeho kouči) | `user.service.ts` `removeCoachRelationByUserId` |
| Žádost o sdílení dat / odpověď | klient / kouč | `access-request.service.ts` |
| Nová recenze | kouč | `coachProfile.controller.ts` `addReview` |
| Chat zpráva (vč. workout note) | druhá strana | `chat.service.ts` |
| Schůzky: žádost, odpověď, zrušení | druhá strana | `meetings.service.ts` |
| Cron: připomínka schůzky (hodinově) | kouč i klient | `meetings.service.ts` `remindUpcoming` |
| Cron: klienti odpadají (denně 6:00) | kouč | `retention.service.ts` |

Záměrně bez notifikace: RPE hodnocení, body fotky, váha (pokrývá "Workout Completed!").
