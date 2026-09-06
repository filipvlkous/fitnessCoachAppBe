import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * What the app reports as its own version: `0.0.38`, from `app.json`. Anything
 * that is not a dotted run of digits is treated as unset rather than guessed
 * at — see `version()` below for why that matters.
 */
const VERSION_PATTERN = /^\d+(\.\d+)*$/;

export type AppVersionPolicy = {
  /** Below this the app must refuse to run. `null` disables the gate. */
  minSupported: string | null;
  /** Newest release, informational — the app does not block on it. */
  latest: string | null;
  iosUrl: string | null;
  androidUrl: string | null;
};

/**
 * Reads a version out of the environment, or `null`.
 *
 * A malformed value is `null` on purpose. This number is the one thing that can
 * lock every user out of a working app, and a typo'd `MIN_APP_VERSION` ("v1.2",
 * "1.2.3-beta") compared loosely could easily read as "newer than everything".
 * Refusing to interpret it means the worst a bad value can do is leave the gate
 * open, which is the same as not having configured it at all.
 */
const version = (raw: string | undefined): string | null => {
  const value = raw?.trim();
  if (!value || !VERSION_PATTERN.test(value)) return null;
  return value;
};

const url = (raw: string | undefined): string | null => {
  const value = raw?.trim();
  return value ? value : null;
};

/**
 * The minimum app version the backend will serve.
 *
 * Deliberately public: the client checks this before it has a session, because
 * an app old enough to be broken is old enough to be broken on the sign-in
 * screen, and because an expired token must never be the reason someone is not
 * told to update.
 *
 * It is env-configured rather than stored, for the same reason the gate exists
 * at all — the floor has to be raiseable without shipping anything, least of
 * all a new version of the app that cannot reach the people who need it.
 */
@ApiTags('app-version')
@Controller('app-version')
export class AppVersionController {
  @Get()
  @ApiOperation({
    summary: 'Minimum supported app version and where to get the update',
  })
  getPolicy(): { data: AppVersionPolicy; message: string } {
    const data: AppVersionPolicy = {
      minSupported: version(process.env.MIN_APP_VERSION),
      latest: version(process.env.LATEST_APP_VERSION),
      // The same two the invite page already links to, so a store URL is
      // configured once for the whole backend.
      iosUrl: url(process.env.IOS_STORE_URL),
      androidUrl: url(process.env.ANDROID_STORE_URL),
    };

    return { data, message: 'App version policy fetched successfully.' };
  }
}
