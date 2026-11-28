/** A RAWJOBS_<name> setting. */
export const envSetting = (name: string): string | undefined => process.env[`RAWJOBS_${name}`];
