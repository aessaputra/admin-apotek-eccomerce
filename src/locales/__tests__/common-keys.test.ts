import { describe, expect, it } from "vitest";
import idCommon from "../id/common.json";
import enCommon from "../en/common.json";

function getValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

const REQUIRED_AUTH_KEYS = [
  "auth.accessDenied",
  "auth.oauthNotAllowed",
  "auth.registerDisabled",
  "auth.checkFailed",
  "auth.sessionNotFound",
  "auth.unexpectedError",
  "auth.loginFailed",
  "auth.invalidEmailOrPassword",
  "auth.forgotPasswordFailed",
  "auth.invalidEmail",
  "auth.updatePasswordFailed",
  "auth.invalidPassword",
  "auth.email",
  "auth.password",
  "auth.login.title",
  "auth.login.description",
  "auth.login.submit",
  "auth.login.forgotPassword",
];

const REQUIRED_PAGES_KEYS = [
  "pages.login.signin",
  "pages.register.buttons.haveAccount",
  "pages.forgotPassword.title",
  "pages.forgotPassword.fields.email",
  "pages.forgotPassword.errors.requiredEmail",
  "pages.forgotPassword.errors.validEmail",
  "pages.forgotPassword.buttons.haveAccount",
  "pages.forgotPassword.buttons.submit",
  "pages.forgotPassword.signin",
  "pages.updatePassword.title",
  "pages.updatePassword.fields.password",
  "pages.updatePassword.fields.confirmPassword",
  "pages.updatePassword.errors.requiredPassword",
  "pages.updatePassword.errors.requiredConfirmPassword",
  "pages.updatePassword.errors.confirmPasswordNotMatch",
  "pages.updatePassword.buttons.submit",
];

const REQUIRED_KEYS = [...REQUIRED_AUTH_KEYS, ...REQUIRED_PAGES_KEYS];

describe("locale files", () => {
  it.each(REQUIRED_KEYS)("has key %s in both id and en locales", (key) => {
    const idValue = getValue(idCommon, key);
    const enValue = getValue(enCommon, key);

    expect(idValue, `missing in id/common.json: ${key}`).toBeTypeOf("string");
    expect(enValue, `missing in en/common.json: ${key}`).toBeTypeOf("string");
    expect(String(idValue).trim().length, `empty in id/common.json: ${key}`).toBeGreaterThan(0);
    expect(String(enValue).trim().length, `empty in en/common.json: ${key}`).toBeGreaterThan(0);
  });
});
