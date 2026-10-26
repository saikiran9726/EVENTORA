import React from 'react';
import {
  FormFieldItem,
  DEFAULT_DIETARY_OPTIONS,
} from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';

export interface DynamicRegistrationFormProps {
  fields: FormFieldItem[];
  answers: Record<string, any>; // key format: `${attendeeIndex}_${fieldId}` or `${fieldId}`
  onAnswerChange: (fieldId: string, value: any, attendeeIndex?: number) => void;
  errors?: Record<string, string>;
  ticketQuantity?: number;
}

/**
 * Validates dynamic form answers on the client side prior to submission.
 */
export function validateDynamicForm(
  fields: FormFieldItem[],
  answers: Record<string, any>,
  ticketQuantity: number = 1
): { isValid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const attendeeCount = Math.max(1, ticketQuantity);

  for (let attIdx = 0; attIdx < attendeeCount; attIdx++) {
    for (const field of fields) {
      const fieldKey = `${attIdx}_${field.id}`;
      // Support fallback to flat fieldId if single ticket
      const value =
        answers[fieldKey] !== undefined ? answers[fieldKey] : answers[field.id || ''];

      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim() === '') ||
        (Array.isArray(value) && value.length === 0);

      // 1. Required check
      if (field.required && isEmpty) {
        errors[fieldKey] = `Please answer "${field.label}"`;
        continue;
      }

      if (isEmpty) continue;

      // 2. Type-specific checks
      if (field.type === 'email' && typeof value === 'string') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
          errors[fieldKey] = 'Enter a valid email address';
        }
      } else if (field.type === 'phone' && typeof value === 'string') {
        if (!/^\+?[0-9\s-]{7,15}$/.test(value.trim())) {
          errors[fieldKey] = 'Enter a valid phone number (7-15 digits)';
        }
      } else if (field.type === 'number') {
        const num = parseFloat(value);
        if (isNaN(num)) {
          errors[fieldKey] = 'Enter a valid number';
        } else if (field.validation?.min !== undefined && num < field.validation.min) {
          errors[fieldKey] = `Value cannot be less than ${field.validation.min}`;
        } else if (field.validation?.max !== undefined && num > field.validation.max) {
          errors[fieldKey] = `Value cannot exceed ${field.validation.max}`;
        }
      } else if (field.type === 'checkbox' && field.required && !value) {
        errors[fieldKey] = 'This checkbox must be accepted';
      }

      // 3. Custom pattern regex
      if (
        (field.type === 'short_text' || field.type === 'long_text') &&
        typeof value === 'string' &&
        field.validation?.pattern
      ) {
        try {
          const reg = new RegExp(field.validation.pattern);
          if (!reg.test(value.trim())) {
            errors[fieldKey] = field.validation.errorMessage || 'Invalid format';
          }
        } catch {
          // ignore malformed regex
        }
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export const DynamicRegistrationForm: React.FC<DynamicRegistrationFormProps> = ({
  fields,
  answers,
  onAnswerChange,
  errors = {},
  ticketQuantity = 1,
}) => {
  if (!fields || fields.length === 0) {
    return null;
  }

  const sortedFields = [...fields].sort((a, b) => a.position - b.position);
  const attendeeCount = Math.max(1, ticketQuantity);
  const [activeAttendeeTab, setActiveAttendeeTab] = React.useState<number>(0);

  const renderField = (field: FormFieldItem, attendeeIndex: number) => {
    const fieldKey = `${attendeeIndex}_${field.id}`;
    const value =
      answers[fieldKey] !== undefined ? answers[fieldKey] : answers[field.id || ''] ?? '';
    const errorMsg = errors[fieldKey];

    switch (field.type) {
      case 'short_text':
      case 'email':
      case 'phone':
        return (
          <div key={field.id} className="space-y-1">
            <Input
              id={`field-${fieldKey}`}
              label={field.label}
              required={field.required}
              type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
              placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
              value={value}
              error={errorMsg}
              onChange={(e) => onAnswerChange(field.id!, e.target.value, attendeeIndex)}
            />
            {field.helpText && !errorMsg && (
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            )}
          </div>
        );

      case 'long_text':
        return (
          <div key={field.id} className="space-y-1">
            <label className="text-xs font-semibold text-text block">
              {field.label}
              {field.required && <span className="text-error ml-1">*</span>}
            </label>
            <Textarea
              id={`field-${fieldKey}`}
              rows={3}
              placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
              value={value}
              error={errorMsg}
              onChange={(e) => onAnswerChange(field.id!, e.target.value, attendeeIndex)}
            />
            {field.helpText && !errorMsg && (
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            )}
            {errorMsg && <p className="text-[11px] text-error font-medium">{errorMsg}</p>}
          </div>
        );

      case 'number':
        return (
          <div key={field.id} className="space-y-1">
            <Input
              id={`field-${fieldKey}`}
              label={field.label}
              required={field.required}
              type="number"
              min={field.validation?.min}
              max={field.validation?.max}
              placeholder={field.helpText || '0'}
              value={value}
              error={errorMsg}
              onChange={(e) => onAnswerChange(field.id!, e.target.value, attendeeIndex)}
            />
            {field.helpText && !errorMsg && (
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            )}
          </div>
        );

      case 'date':
        return (
          <div key={field.id} className="space-y-1">
            <Input
              id={`field-${fieldKey}`}
              label={field.label}
              required={field.required}
              type="date"
              value={value}
              error={errorMsg}
              onChange={(e) => onAnswerChange(field.id!, e.target.value, attendeeIndex)}
            />
            {field.helpText && !errorMsg && (
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            )}
          </div>
        );

      case 'dropdown': {
        const options = (field.options || []).map((opt) => ({ value: opt, label: opt }));
        return (
          <div key={field.id} className="space-y-1">
            <Select
              id={`field-${fieldKey}`}
              label={field.label}
              options={[{ value: '', label: 'Select an option...' }, ...options]}
              value={value}
              error={errorMsg}
              onChange={(e) => onAnswerChange(field.id!, e.target.value, attendeeIndex)}
            />
            {field.helpText && !errorMsg && (
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            )}
          </div>
        );
      }

      case 'dietary': {
        const opts =
          field.options && field.options.length > 0 ? field.options : DEFAULT_DIETARY_OPTIONS;
        const options = opts.map((opt) => ({ value: opt, label: opt }));
        return (
          <div key={field.id} className="space-y-1">
            <Select
              id={`field-${fieldKey}`}
              label={field.label || 'Dietary Preference'}
              options={[{ value: '', label: 'Select dietary preference...' }, ...options]}
              value={value}
              error={errorMsg}
              onChange={(e) => onAnswerChange(field.id!, e.target.value, attendeeIndex)}
            />
            {field.helpText && !errorMsg && (
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            )}
          </div>
        );
      }

      case 'radio':
        return (
          <div key={field.id} className="space-y-1.5">
            <label className="text-xs font-semibold text-text block">
              {field.label}
              {field.required && <span className="text-error ml-1">*</span>}
            </label>
            {field.helpText && <p className="text-[11px] text-text-muted mb-1">{field.helpText}</p>}
            <div className="space-y-1.5">
              {(field.options || []).map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 text-xs text-text cursor-pointer hover:text-brand"
                >
                  <input
                    type="radio"
                    name={`radio-${fieldKey}`}
                    value={opt}
                    checked={value === opt}
                    onChange={() => onAnswerChange(field.id!, opt, attendeeIndex)}
                    className="text-brand focus:ring-brand"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            {errorMsg && <p className="text-[11px] text-error font-medium">{errorMsg}</p>}
          </div>
        );

      case 'checkbox':
        return (
          <div key={field.id} className="space-y-1 pt-1">
            <Checkbox
              id={`field-${fieldKey}`}
              label={field.label}
              checked={Boolean(value)}
              onChange={(e) => onAnswerChange(field.id!, e.target.checked, attendeeIndex)}
            />
            {field.helpText && <p className="text-[11px] text-text-muted ml-6">{field.helpText}</p>}
            {errorMsg && <p className="text-[11px] text-error font-medium ml-6">{errorMsg}</p>}
          </div>
        );

      case 'multi_checkbox': {
        const selectedList: string[] = Array.isArray(value) ? value : [];
        const toggleOption = (opt: string) => {
          const next = selectedList.includes(opt)
            ? selectedList.filter((x) => x !== opt)
            : [...selectedList, opt];
          onAnswerChange(field.id!, next, attendeeIndex);
        };

        return (
          <div key={field.id} className="space-y-1.5">
            <label className="text-xs font-semibold text-text block">
              {field.label}
              {field.required && <span className="text-error ml-1">*</span>}
            </label>
            {field.helpText && <p className="text-[11px] text-text-muted mb-1">{field.helpText}</p>}
            <div className="space-y-1.5">
              {(field.options || []).map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 text-xs text-text cursor-pointer hover:text-brand"
                >
                  <input
                    type="checkbox"
                    checked={selectedList.includes(opt)}
                    onChange={() => toggleOption(opt)}
                    className="rounded border-border text-brand focus:ring-brand"
                  />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            {errorMsg && <p className="text-[11px] text-error font-medium">{errorMsg}</p>}
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="space-y-4 pt-2 border-t border-border">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-text uppercase tracking-wider">
          Event Registration Questions
        </h4>
        {attendeeCount > 1 && (
          <span className="text-[11px] text-brand font-medium">
            Per-attendee details for {attendeeCount} tickets
          </span>
        )}
      </div>

      {attendeeCount > 1 && (
        <div className="flex gap-1.5 border-b border-border pb-2 overflow-x-auto">
          {Array.from({ length: attendeeCount }).map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setActiveAttendeeTab(idx)}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                activeAttendeeTab === idx
                  ? 'bg-brand text-white'
                  : 'bg-surface-2 text-text-muted hover:text-text'
              }`}
            >
              Attendee #{idx + 1}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3.5">
        {attendeeCount > 1 ? (
          <div>
            <div className="text-[11px] font-semibold text-text-muted mb-3">
              Questions for Attendee #{activeAttendeeTab + 1}:
            </div>
            <div className="space-y-3.5">
              {sortedFields.map((field) => renderField(field, activeAttendeeTab))}
            </div>
          </div>
        ) : (
          sortedFields.map((field) => renderField(field, 0))
        )}
      </div>
    </div>
  );
};
