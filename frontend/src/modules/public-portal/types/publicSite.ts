/**
 * The department's public website settings (`/api/v1/public-site/settings`).
 *
 * snake_case on the wire: `schemas/public_site.py` carries no alias generator.
 */

export interface PublicSiteThemeOption {
  value: string;
  label: string;
  description: string;
}

export interface PublicSiteContactOnRecord {
  phone: string | null;
  email: string | null;
  address_lines: string[];
}

export interface PublicSiteSwitches {
  enabled: boolean;
  show_about: boolean;
  show_contact: boolean;
  show_phone: boolean;
  show_email: boolean;
  show_address: boolean;
  show_member_login: boolean;
}

export interface PublicSiteText {
  tagline: string | null;
  welcome_text: string | null;
  about_text: string | null;
  emergency_notice: string | null;
}

export interface PublicSiteSettings extends PublicSiteSwitches, PublicSiteText {
  theme: string;
  themes: PublicSiteThemeOption[];
  contact_on_record: PublicSiteContactOnRecord;
  /** False when the installation holds more than one department. */
  servable: boolean;
}

/** Every field the settings form owns, sent whole on each save. */
export interface PublicSiteSettingsUpdate extends PublicSiteSwitches, PublicSiteText {
  theme: string;
}
