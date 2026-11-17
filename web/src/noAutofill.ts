// Safari AutoFill on a plain text field makes the installed Mac web app ask for the
// "Safari Forms AutoFill Encryption Key" keychain item (#472). Spread this on every
// input that is not a sign-in or password field.
export const NO_AUTOFILL = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-form-type": "other",
} as const;
