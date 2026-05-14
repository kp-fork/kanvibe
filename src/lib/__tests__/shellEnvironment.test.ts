import { afterEach, describe, expect, it } from "vitest";
import { createLocalShellEnvironment } from "../shellEnvironment";

const ENV_KEYS_TO_RESTORE = [
  "PORT",
  "HOST",
  "NODE_ENV",
  "KANVIBE_HOST",
  "KANVIBE_APP_DATA_DIR",
  "KANVIBE_DESKTOP",
  "KANVIBE_REMOTE_SSH_COMMAND_TIMEOUT_MS",
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
];

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS_TO_RESTORE.map((key) => [key, process.env[key]]),
);

function restoreProcessEnv(): void {
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("createLocalShellEnvironment", () => {
  afterEach(() => {
    restoreProcessEnv();
  });

  it("does not leak KanVibe or generic runtime variables into local shells", () => {
    process.env.PORT = "9736";
    process.env.HOST = "0.0.0.0";
    process.env.NODE_ENV = "production";
    process.env.KANVIBE_HOST = "0.0.0.0";
    process.env.KANVIBE_APP_DATA_DIR = "/tmp/kanvibe-app-data";
    process.env.KANVIBE_DESKTOP = "true";
    process.env.KANVIBE_REMOTE_SSH_COMMAND_TIMEOUT_MS = "1000";
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/terminal-user";
    delete process.env.LANG;
    delete process.env.LC_ALL;

    const environment = createLocalShellEnvironment();

    expect(environment.PORT).toBeUndefined();
    expect(environment.HOST).toBeUndefined();
    expect(environment.NODE_ENV).toBeUndefined();
    expect(environment.KANVIBE_HOST).toBeUndefined();
    expect(environment.KANVIBE_APP_DATA_DIR).toBeUndefined();
    expect(environment.KANVIBE_DESKTOP).toBeUndefined();
    expect(environment.KANVIBE_REMOTE_SSH_COMMAND_TIMEOUT_MS).toBeUndefined();
    expect(environment.PATH).toContain("/usr/bin");
    expect(environment.HOME).toBe("/home/terminal-user");
    expect(environment.LANG).toBe("en_US.UTF-8");
    expect(environment.LC_ALL).toBe("en_US.UTF-8");
  });
});
