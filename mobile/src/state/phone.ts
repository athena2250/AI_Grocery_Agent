/**
 * Mobile numbers by country → E.164. Pure; used by sign-in/sign-up and the
 * profile page. Dial codes here never prefix one another, so an E.164 string
 * maps back to exactly one country.
 */
export interface Country {
  code: 'IN' | 'US' | 'GB' | 'AE' | 'SG' | 'AU';
  name: string;
  /** "+91" */
  dial: string;
  flag: string;
  /** Length of the national mobile number, without the trunk 0. */
  digits: number;
  /** What a mobile number starts with, so a landline or typo is caught early. */
  starts: RegExp;
}

export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', digits: 10, starts: /^[6-9]/ },
  { code: 'US', name: 'United States / Canada', dial: '+1', flag: '🇺🇸', digits: 10, starts: /^[2-9]/ },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', digits: 10, starts: /^7/ },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪', digits: 9, starts: /^5/ },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', digits: 8, starts: /^[89]/ },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', digits: 9, starts: /^4/ },
];

export const INDIA = COUNTRIES[0];

export const countryByCode = (code: string) => COUNTRIES.find((x) => x.code === code) ?? INDIA;

const dialDigits = (country: Country) => country.dial.slice(1);

/**
 * What the phone field keeps as you type: digits only, at most the country's
 * length. A pasted `+91 98765 43210` or `098765 43210` loses its prefix first.
 */
export function localDigits(country: Country, input: string): string {
  let d = input.replace(/\D/g, '');
  if (d.length > country.digits && d.startsWith(dialDigits(country))) d = d.slice(dialDigits(country).length);
  else if (d.length > country.digits && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, country.digits);
}

/** Returns null for blank input and 'invalid' when it isn't a mobile number for that country. */
export function toE164(country: Country, input: string): string | null | 'invalid' {
  let d = input.replace(/\D/g, '');
  if (!d) return null;
  const dial = dialDigits(country);
  if (d.length === country.digits + dial.length && d.startsWith(dial)) d = d.slice(dial.length);
  else if (d.length === country.digits + 1 && d.startsWith('0')) d = d.slice(1);
  return d.length === country.digits && country.starts.test(d) ? `+${dial}${d}` : 'invalid';
}

/** `+919876543210` → India + `9876543210`. Unknown or missing numbers read as India. */
export function splitE164(e164: string | null): { country: Country; local: string } {
  if (!e164) return { country: INDIA, local: '' };
  const country = COUNTRIES.find((x) => e164.startsWith(x.dial)) ?? INDIA;
  return { country, local: e164.startsWith(country.dial) ? e164.slice(country.dial.length) : e164.replace(/\D/g, '') };
}

/** `+919876543210` → `+91 98765 43210`, for showing back to people. */
export function formatPhone(e164: string): string {
  const { country, local } = splitE164(e164);
  const mid = Math.ceil(local.length / 2);
  return `${country.dial} ${local.slice(0, mid)} ${local.slice(mid)}`;
}
