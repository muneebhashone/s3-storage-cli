import type { EnvCheck } from "./config";

export interface CliIo {
  stderr: (line: string) => void;
  stdout: (line: string) => void;
}

export function createDefaultIo(): CliIo {
  return {
    stderr: (line) => process.stderr.write(`${line}\n`),
    stdout: (line) => process.stdout.write(`${line}\n`),
  };
}

export function emitJson(io: CliIo, data: unknown): void {
  io.stdout(JSON.stringify(data));
}

export function emitError(io: CliIo, code: string, message: string): void {
  io.stderr(`error\t${code}\t${message}`);
}

export function emitEnvCheck(io: CliIo, check: EnvCheck): void {
  if (check.ok) {
    io.stdout(`ok\tenv\t${check.key}`);
    return;
  }

  emitError(io, "env", check.message ?? `invalid ${check.key}`);
}

export function formatTimestamp(value: string): string {
  return new Date(value).toISOString();
}
