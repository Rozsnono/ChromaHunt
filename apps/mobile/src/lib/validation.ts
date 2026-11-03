/** Client side input checks (the server validates again; these are for instant feedback). */
export const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
export const isValidPassword = (value: string): boolean => value.length >= 10 && value.length <= 128;
export const isValidDisplayName = (value: string): boolean => value.trim().length >= 2 && value.trim().length <= 40;
