import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  AuthToken,
  consumeAuthToken,
  createAuthToken,
  hashAuthToken,
  revokeAuthTokens,
} from "../src/server/authTokens";
import {
  providerSmtpIssues,
  validateSmtpSetup,
} from "../src/server/integrations/smtpSetup";
import type { IntegrationFieldState } from "../src/server/integrations/types";
import { sendVerificationToExistingUsers } from "../src/server/email/accountMail";
import {
  asSmtpValues,
  fromAddress,
  smtpTransportOptions,
} from "../src/server/email/transport";
import {
  adminInviteEmail,
  passwordResetEmail,
  renderEmailTemplate,
  verifyEmailEmail,
  DARK_EMAIL_THEME,
} from "../src/server/email/templates";

const USER_ID = "507f1f77bcf86cd799439011";

const originals = {
  create: AuthToken.create,
  deleteMany: AuthToken.deleteMany,
  findOneAndUpdate: AuthToken.findOneAndUpdate,
};

afterEach(() => {
  (AuthToken as any).create = originals.create;
  (AuthToken as any).deleteMany = originals.deleteMany;
  (AuthToken as any).findOneAndUpdate = originals.findOneAndUpdate;
});

describe("auth tokens", () => {
  test("stores only a hash and replaces outstanding tokens for the purpose", async () => {
    const cleared: any[] = [];
    let created: any = null;
    (AuthToken as any).deleteMany = (filter: any) => {
      cleared.push(filter);
      return { exec: async () => ({}) };
    };
    (AuthToken as any).create = async (doc: any) => {
      created = doc;
      return doc;
    };

    const token = await createAuthToken(USER_ID, "password_reset", 60_000);

    assert.ok(token.length >= 20);
    assert.deepEqual(cleared, [{ userId: USER_ID, purpose: "password_reset", usedAt: null }]);
    assert.equal(created.purpose, "password_reset");
    assert.equal(created.tokenHash, hashAuthToken(token));
    assert.notEqual(created.tokenHash, token);
    assert.ok(created.expiresAt.getTime() > Date.now());
  });

  test("consumes only an unexpired, unused token and returns the owner", async () => {
    let filter: any = null;
    let update: any = null;
    (AuthToken as any).findOneAndUpdate = (f: any, u: any) => {
      filter = f;
      update = u;
      return { lean: () => ({ exec: async () => ({ userId: USER_ID }) }) };
    };
    const token = "t".repeat(40);

    assert.equal(await consumeAuthToken(token, "email_verification"), USER_ID);
    assert.equal(filter.tokenHash, hashAuthToken(token));
    assert.equal(filter.purpose, "email_verification");
    assert.equal(filter.usedAt, null);
    assert.ok(filter.expiresAt.$gt instanceof Date);
    assert.ok(update.$set.usedAt instanceof Date);
  });

  test("rejects malformed, unknown and already-used tokens", async () => {
    assert.equal(await consumeAuthToken("short", "password_reset"), null);
    assert.equal(await consumeAuthToken(undefined, "password_reset"), null);
    (AuthToken as any).findOneAndUpdate = () => ({
      lean: () => ({ exec: async () => null }),
    });
    assert.equal(await consumeAuthToken("x".repeat(40), "password_reset"), null);
  });

  test("revokes every token or one purpose", async () => {
    const filters: any[] = [];
    (AuthToken as any).deleteMany = (filter: any) => {
      filters.push(filter);
      return { exec: async () => ({}) };
    };
    await revokeAuthTokens(USER_ID);
    await revokeAuthTokens(USER_ID, "admin_invite");
    assert.deepEqual(filters, [{ userId: USER_ID }, { userId: USER_ID, purpose: "admin_invite" }]);
  });
});

describe("email templates", () => {
  test("resets escape the brand and encode the link", () => {
    const mail = passwordResetEmail({
      brand: "Acme <&>",
      url: "https://example.test/reset?token=a&b=1",
      expiresMinutes: 45,
    });
    assert.match(mail.subject, /Acme <&>/);
    assert.match(mail.html, /Acme &lt;&amp;&gt;/);
    assert.match(mail.html, /https:\/\/example\.test\/reset\?token=a&amp;b=1/);
    assert.match(mail.text, /expires in 45 minutes/);
  });

  test("verification and invite copy include the action link", () => {
    const verify = verifyEmailEmail({
      brand: "Doochy",
      url: "https://example.test/verify-email?token=abc",
      expiresMinutes: 45,
    });
    assert.match(verify.subject, /Verify your email/);
    assert.match(verify.text, /https:\/\/example\.test\/verify-email\?token=abc/);

    const invite = adminInviteEmail({
      brand: "Doochy",
      url: "https://example.test/accept-invite?token=abc",
      username: "alice",
      expiresMinutes: 45,
    });
    assert.match(invite.subject, /invited/);
    assert.match(invite.text, /as alice/);
    assert.match(invite.html, /https:\/\/example\.test\/accept-invite\?token=abc/);
  });

  test("verification mail uses the dark site palette", () => {
    const verify = verifyEmailEmail({
      brand: "Doochy",
      url: "https://example.test/verify-email?token=abc",
      expiresMinutes: 45,
    });

    assert.match(verify.html, /background-color:#0a0e14/);
    assert.match(verify.html, /background-color:#141c28/);
    assert.match(verify.html, /content="dark"/);
    assert.match(verify.html, /Verify email<\/a>/);
    assert.match(verify.text, /Click this button:/);
    assert.match(verify.text, /signs you in/);
    assert.doesNotMatch(verify.text, /Open this link:/);
    assert.doesNotMatch(verify.html, /#f1f5f9/);
  });

  test("admin verification copy uses the supplied dark theme", () => {
    const custom = renderEmailTemplate(
      { subject: "Confirm {{brand}}", body: "Verify at {{url}}" },
      { brand: "Doochy", url: "https://example.test/verify-email?token=abc" },
      { ...DARK_EMAIL_THEME, accent: "#abcdef" }
    );

    assert.match(custom.subject, /Confirm Doochy/);
    assert.match(custom.html, /background-color:#0a0e14/);
    assert.match(custom.html, /color:#abcdef/);
    assert.match(custom.html, /content="dark"/);
  });

  test("stored verification copy gains a button and updated wording", () => {
    const url = "https://example.test/verify-email?token=abc";
    const custom = renderEmailTemplate(
      {
        subject: "Verify your email for {{brand}}",
        body: "Confirm your email address for {{brand}}.\n\nOpen this link:\n{{url}}\n\nExpires in {{expiresMinutes}} minutes.",
      },
      { brand: "Doochy", url, expiresMinutes: 45 },
      DARK_EMAIL_THEME,
      { label: "Verify email", url }
    );

    assert.match(custom.text, /Click this button:/);
    assert.doesNotMatch(custom.text, /Open this link:/);
    assert.match(custom.html, />Verify email<\/a>/);
    assert.match(custom.html, /href="https:\/\/example\.test\/verify-email\?token=abc"/);
    assert.doesNotMatch(custom.html, /Open this link:/);
  });
});

function smtpField(
  key: string,
  kind: IntegrationFieldState["kind"],
  overrides: Partial<IntegrationFieldState> = {}
): IntegrationFieldState {
  return {
    key,
    label: key,
    kind,
    required: false,
    value: null,
    configured: false,
    source: "unset",
    hint: null,
    error: null,
    ...overrides,
  };
}

describe("SMTP setup", () => {
  test("requires a password when a username is set", () => {
    const issues = validateSmtpSetup({ username: "user", password: "" });
    assert.deepEqual(issues.errors, ["SMTP password is required when a username is set."]);
  });

  test("accepts a saved password when checking admin field state", () => {
    const issues = providerSmtpIssues([
      smtpField("username", "text", {
        value: "postmaster@example.test",
        configured: true,
        source: "database",
      }),
      smtpField("password", "secret", { configured: true, source: "database" }),
    ]);
    assert.deepEqual(issues.errors, []);
  });

  test("does not count an unusable saved password", () => {
    const issues = providerSmtpIssues([
      smtpField("username", "text", { value: "user", configured: true }),
      smtpField("password", "secret", {
        configured: true,
        source: "database",
        error: "stored secret could not be decrypted",
      }),
    ]);
    assert.deepEqual(issues.errors, ["SMTP password is required when a username is set."]);
  });

  test("warns about insecure and mismatched transport choices", () => {
    assert.ok(
      validateSmtpSetup({ encryption: "none" }).warnings.some((line) => /encryption is off/.test(line))
    );
    assert.ok(
      validateSmtpSetup({ encryption: "tls", port: 587 }).warnings.some((line) => /465/.test(line))
    );
    assert.ok(
      validateSmtpSetup({ encryption: "starttls", port: 465 }).warnings.some((line) => /implicit TLS/.test(line))
    );
  });

  test("maps saved values to nodemailer options", () => {
    const values = asSmtpValues({
      host: " smtp.example.test ",
      port: "587",
      encryption: "starttls",
      username: "user",
      password: "secret",
      fromEmail: "noreply@example.test",
      fromName: "Doochy",
    });
    const options = smtpTransportOptions(values);
    assert.equal(values.host, "smtp.example.test");
    assert.equal(options.secure, false);
    assert.equal(options.requireTLS, true);
    assert.deepEqual(options.auth, { user: "user", pass: "secret" });
    assert.equal(fromAddress(values, "Brand"), '"Doochy" <noreply@example.test>');
  });

  test("does not accept a host or from address as complete by mistake", () => {
    assert.throws(() => asSmtpValues({ port: 587, fromEmail: "a@b.test" }));
    assert.throws(() => asSmtpValues({ host: "smtp.example.test", port: 587 }));
  });
});

describe("existing user verification emails", () => {
  test("sends to every existing unverified user", async () => {
    const sent: string[] = [];
    const result = await sendVerificationToExistingUsers({} as any, {
      emailConfigured: async () => true,
      findUnverifiedUsers: async () => ["user-1", "user-2"],
      sendVerification: async (userId) => {
        sent.push(userId);
      },
      logError: () => {},
    });

    assert.deepEqual(sent, ["user-1", "user-2"]);
    assert.deepEqual(result, {
      eligible: 2,
      sent: 2,
      failed: 0,
      skippedNotConfigured: false,
    });
  });

  test("skips the backfill when email delivery is not configured", async () => {
    let queried = false;
    const result = await sendVerificationToExistingUsers({} as any, {
      emailConfigured: async () => false,
      findUnverifiedUsers: async () => {
        queried = true;
        return ["user-1"];
      },
      logError: () => {},
    });

    assert.equal(queried, false);
    assert.deepEqual(result, {
      eligible: 0,
      sent: 0,
      failed: 0,
      skippedNotConfigured: true,
    });
  });

  test("counts a failed send without stopping the remaining users", async () => {
    const errors: string[] = [];
    const sent: string[] = [];
    const result = await sendVerificationToExistingUsers({} as any, {
      emailConfigured: async () => true,
      findUnverifiedUsers: async () => ["user-1", "user-2", "user-3"],
      sendVerification: async (userId) => {
        if (userId === "user-2") throw new Error("mailbox rejected");
        sent.push(userId);
      },
      logError: (message) => errors.push(message),
    });

    assert.deepEqual(sent, ["user-1", "user-3"]);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /user-2/);
    assert.deepEqual(result, {
      eligible: 3,
      sent: 2,
      failed: 1,
      skippedNotConfigured: false,
    });
  });
});
