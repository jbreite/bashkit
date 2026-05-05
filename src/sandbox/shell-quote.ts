/**
 * POSIX shell single-quote escaping for safe path interpolation.
 *
 * Wraps the input in single quotes and escapes any embedded single quote as
 * `'\''`. Safe for use with `sh -c` / `bash -c` argv. Always combine with `--`
 * after the command (e.g. `rm -- ${shellQuote(path)}`) so paths starting with
 * `-` aren't parsed as flags.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
