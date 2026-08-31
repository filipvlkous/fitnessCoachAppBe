# AGENTS.md

## Think Before Coding

- State assumptions explicitly.
- If requirements are ambiguous, ask rather than guess.
- If multiple interpretations exist, present them.
- Prefer the simplest viable approach.

## Simplicity First

- Write the minimum code necessary.
- Do not add unrequested features.
- Avoid speculative abstractions and configurability.
- If the implementation can be substantially simpler, simplify it.

## Surgical Changes

- Change only what is necessary for the task.
- Do not refactor unrelated code.
- Match the existing codebase style.
- Remove only unused code introduced by your changes.
- Mention unrelated problems rather than fixing them without being asked.

## Goal-Driven Execution

- Define concrete success criteria before implementation.
- For bugs, reproduce the problem before fixing it.
- Prefer tests or other deterministic verification.
- For multi-step work, define each step together with how it will be verified.
- Continue until the success criteria are satisfied.

## Tasks

Pokud existuje `internal/tasks/current-task.md`, přečti ho jako první — obsahuje kontext aktivního úkolu. Adresář je gitignored a nemusí existovat; když tam není, pokračuj normálně.

U víckrokové práce:

1. Nejdřív napiš plán do `internal/tasks/current-task.md`, pak začni.
2. Po každém dokončeném kroku aktualizuj checkbox.
3. Rozhodnutí a jejich důvody zapisuj průběžně, ne až na konci.
4. Po dokončení: co má trvalou hodnotu přesuň do `internal/docs/`, zbytek smaž.

