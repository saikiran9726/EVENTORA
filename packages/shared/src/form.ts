/**
 * Custom Registration Form Field Types & Interfaces
 */

export const FORM_FIELD_TYPES = [
  'short_text',
  'long_text',
  'dropdown',
  'radio',
  'checkbox',
  'multi_checkbox',
  'phone',
  'email',
  'number',
  'date',
  'dietary',
] as const;

export type FormFieldType = typeof FORM_FIELD_TYPES[number];

export const DEFAULT_DIETARY_OPTIONS = [
  'Vegetarian',
  'Vegan',
  'Jain',
  'Halal',
  'No Preference',
] as const;

export interface FormFieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  errorMessage?: string;
}

export interface FormFieldItem {
  id?: string;
  eventId?: string;
  position: number;
  type: FormFieldType;
  label: string;
  helpText?: string | null;
  required: boolean;
  options: string[];
  validation: FormFieldValidation;
  version?: number;
}

export interface EventFormConfig {
  eventId: string;
  version: number;
  isFrozen: boolean;
  registrationCount: number;
  fields: FormFieldItem[];
}

export interface RegistrationAnswerItem {
  fieldId: string;
  value: any;
  attendeeIndex?: number;
}
