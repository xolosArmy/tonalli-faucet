export const WELCOME_TURNSTILE_INCOMPATIBLE_MESSAGE =
  "Welcome XEC Quick Start requires TURNSTILE_ENABLED=false.";

export function isWelcomeQuickStartCompatible(input: { turnstileEnabled: boolean }): boolean {
  return input.turnstileEnabled !== true;
}
