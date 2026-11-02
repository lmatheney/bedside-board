export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let national = digits;
  if (national.length === 11 && national.startsWith("1")) national = national.slice(1);
  if (national.length !== 10) return null;
  return `+1${national}`;
}

export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  const national = digits.length === 11 ? digits.slice(1) : digits;
  if (national.length !== 10) return e164;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
