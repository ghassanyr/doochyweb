// Small readline wrapper for the setup CLI. Passwords use raw mode so they are
// never echoed and never land in shell history.

import { stdin, stdout } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";

function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    // Piped input cannot hide characters. Still accept a value so automation
    // does not hang.
    const rl = createInterface({ input: stdin, output: stdout });
    return rl.question(prompt).finally(() => rl.close());
  }

  stdout.write(prompt);
  return new Promise<string>((resolve) => {
    let value = "";
    let escape = false;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\u001b") {
          escape = true;
          continue;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        stdout.write("*");
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

export class Prompter {
  private rl: Interface | null = null;

  private get interface(): Interface {
    if (!this.rl) {
      this.rl = createInterface({ input: stdin, output: stdout, terminal: true });
      this.rl.on("SIGINT", () => {
        this.close();
        stdout.write("\n");
        process.exit(130);
      });
    }
    return this.rl;
  }

  async ask(label: string, defaultValue = ""): Promise<string> {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await this.interface.question(`${label}${suffix}: `)).trim();
    return answer || defaultValue;
  }

  async confirm(label: string, defaultValue = true): Promise<boolean> {
    const suffix = defaultValue ? " [Y/n]" : " [y/N]";
    const answer = (await this.interface.question(`${label}${suffix}: `))
      .trim()
      .toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  }

  async select(label: string, options: string[], defaultIndex = 0): Promise<number> {
    stdout.write(`${label}\n`);
    options.forEach((option, index) => stdout.write(`  ${index + 1}. ${option}\n`));
    while (true) {
      const answer = (await this.interface.question(`Choose [${defaultIndex + 1}]: `)).trim();
      if (!answer) return defaultIndex;
      const picked = Number(answer);
      if (Number.isInteger(picked) && picked >= 1 && picked <= options.length) {
        return picked - 1;
      }
      stdout.write(`Enter a number from 1 to ${options.length}.\n`);
    }
  }

  async secret(label: string): Promise<string> {
    this.close();
    return readHidden(`${label}: `);
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}
