import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WELCOME_TURNSTILE_INCOMPATIBLE_MESSAGE,
  isWelcomeQuickStartCompatible
} from "../welcomeQuickStartPolicy.js";

test("Welcome Quick Start is compatible only when Turnstile is disabled", () => {
  assert.equal(isWelcomeQuickStartCompatible({ turnstileEnabled: false }), true);
  assert.equal(isWelcomeQuickStartCompatible({ turnstileEnabled: true }), false);
  assert.match(WELCOME_TURNSTILE_INCOMPATIBLE_MESSAGE, /TURNSTILE_ENABLED=false/);
});
