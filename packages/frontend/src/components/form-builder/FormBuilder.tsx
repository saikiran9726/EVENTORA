import React, { useState, useEffect } from 'react';
import {
  Type,
  AlignLeft,
  ChevronDown,
  CircleDot,
  CheckSquare,
  ListChecks,
  Phone,
  Mail,
  Hash,
  Calendar,
  Utensils,
  Plus,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown as ArrowDown,
  Eye,
  Save,
  AlertTriangle,
  GripVertical,
  Settings,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { apiClient } from '@/lib/api-client';
import {
  FormFieldItem,
  FormFieldType,
  FORM_FIELD_TYPES,
  DEFAULT_DIETARY_OPTIONS,
} from '@/lib/utils';
import { DynamicRegistrationForm } from './DynamicRegistrationForm';

export interface FormBuilderProps {
  eventId: string;
  onSaveSuccess?: () => void;
}

const FIELD_TYPE_METADATA: Record<
  FormFieldType,
  { label: string; icon: React.FC<{ className?: string }>; defaultLabel: string }
> = {
  short_text: { label: 'Short Text', icon: Type, defaultLabel: 'Short Answer' },
  long_text: { label: 'Long Text', icon: AlignLeft, defaultLabel: 'Detailed Answer' },
  dropdown: { label: 'Dropdown', icon: ChevronDown, defaultLabel: 'Select an option' },
  radio: { label: 'Radio Group', icon: CircleDot, defaultLabel: 'Choose one option' },
  checkbox: { label: 'Single Checkbox', icon: CheckSquare, defaultLabel: 'I confirm and agree' },
  multi_checkbox: { label: 'Multi Checkbox', icon: ListChecks, defaultLabel: 'Select all that apply' },
  phone: { label: 'Phone Number', icon: Phone, defaultLabel: 'Contact Phone Number' },
  email: { label: 'Email Address', icon: Mail, defaultLabel: 'Contact Email' },
  number: { label: 'Number', icon: Hash, defaultLabel: 'Numeric Quantity' },
  date: { label: 'Date', icon: Calendar, defaultLabel: 'Select Date' },
  dietary: { label: 'Dietary Preference', icon: Utensils, defaultLabel: 'Dietary Preference' },
};

export const FormBuilder: React.FC<FormBuilderProps> = ({ eventId, onSaveSuccess }) => {
  const { toast } = useToast();
  const [fields, setFields] = useState<FormFieldItem[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [version, setVersion] = useState<number>(0);
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [registrationCount, setRegistrationCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'editor' | 'preview'>('editor');
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, any>>({});
  const [newOptionInput, setNewOptionInput] = useState<string>('');

  // Drag and drop ordering state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const fetchFormConfig = async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<any>(`/api/v1/events/${eventId}/form`);
      const form = res?.form;
      if (form) {
        setFields(
          (form.fields || []).map((f: any, idx: number) => ({
            id: f.id || `fld_${Date.now()}_${idx}`,
            eventId: f.eventId || eventId,
            position: f.position !== undefined ? f.position : idx,
            type: f.type,
            label: f.label || '',
            helpText: f.helpText || '',
            required: Boolean(f.required),
            options: Array.isArray(f.options) ? f.options : [],
            validation: f.validation || {},
            version: f.version || 1,
          }))
        );
        setVersion(form.version || 1);
        setIsFrozen(Boolean(form.isFrozen));
        setRegistrationCount(form.registrationCount || 0);
        if (form.fields && form.fields.length > 0 && !selectedFieldId) {
          setSelectedFieldId(form.fields[0].id);
        }
      }
    } catch (err: any) {
      toast({
        type: 'error',
        title: 'Could Not Load Form',
        message: err?.error?.message || err.message || 'Failed to fetch event registration form.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (eventId) {
      fetchFormConfig();
    }
  }, [eventId]);

  const selectedField = fields.find((f) => f.id === selectedFieldId) || null;

  // Add a new field
  const handleAddField = (type: FormFieldType) => {
    const meta = FIELD_TYPE_METADATA[type];
    const newFieldId = `new_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newField: FormFieldItem = {
      id: newFieldId,
      eventId,
      position: fields.length,
      type,
      label: meta.defaultLabel,
      helpText: '',
      required: false,
      options:
        type === 'dietary'
          ? [...DEFAULT_DIETARY_OPTIONS]
          : ['dropdown', 'radio', 'multi_checkbox'].includes(type)
          ? ['Option 1', 'Option 2']
          : [],
      validation: {},
      version: 1,
    };

    setFields([...fields, newField]);
    setSelectedFieldId(newFieldId);
  };

  // Duplicate an existing field
  const handleDuplicateField = (fieldToDuplicate: FormFieldItem) => {
    const duplicateId = `dup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const currentIdx = fields.findIndex((f) => f.id === fieldToDuplicate.id);
    const newField: FormFieldItem = {
      ...fieldToDuplicate,
      id: duplicateId,
      label: `${fieldToDuplicate.label} (Copy)`,
      position: currentIdx + 1,
      options: [...fieldToDuplicate.options],
      validation: { ...fieldToDuplicate.validation },
    };

    const updated = [...fields];
    updated.splice(currentIdx + 1, 0, newField);
    // Re-index positions
    const reindexed = updated.map((f, idx) => ({ ...f, position: idx }));
    setFields(reindexed);
    setSelectedFieldId(duplicateId);
  };

  // Delete a field
  const handleDeleteField = (fieldId: string) => {
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;

    if (isFrozen && field.id && !field.id.startsWith('new_') && !field.id.startsWith('dup_')) {
      toast({
        type: 'error',
        title: 'Field Locked',
        message: 'Existing fields cannot be removed after registrations have been received.',
      });
      return;
    }

    const updated = fields.filter((f) => f.id !== fieldId).map((f, idx) => ({ ...f, position: idx }));
    setFields(updated);
    if (selectedFieldId === fieldId) {
      setSelectedFieldId(updated.length > 0 ? updated[0].id || null : null);
    }
  };

  // Move field up or down
  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const updated = [...fields];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    const reindexed = updated.map((f, idx) => ({ ...f, position: idx }));
    setFields(reindexed);
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      return;
    }

    const updated = [...fields];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, moved);

    const reindexed = updated.map((f, idx) => ({ ...f, position: idx }));
    setFields(reindexed);
    setDraggedIndex(null);
  };

  // Update a property of the currently selected field
  const updateSelectedField = (patch: Partial<FormFieldItem>) => {
    if (!selectedFieldId) return;
    setFields((prev) =>
      prev.map((f) => (f.id === selectedFieldId ? { ...f, ...patch } : f))
    );
  };

  // Save changes to backend
  const handleSaveForm = async () => {
    setIsSaving(true);
    try {
      const payload = {
        expectedVersion: version,
        fields: fields.map((f, idx) => ({
          id: f.id?.startsWith('new_') || f.id?.startsWith('dup_') ? undefined : f.id,
          position: idx,
          type: f.type,
          label: f.label.trim() || 'Untitled Question',
          helpText: f.helpText ? f.helpText.trim() : null,
          required: Boolean(f.required),
          options: f.options,
          validation: f.validation || {},
        })),
      };

      const res = await apiClient.put<any>(`/api/v1/events/${eventId}/form`, payload);
      const savedForm = res?.form;
      if (savedForm) {
        setVersion(savedForm.version);
        setIsFrozen(Boolean(savedForm.isFrozen));
        setRegistrationCount(savedForm.registrationCount || 0);
        // Refresh with server assigned IDs
        if (savedForm.fields) {
          setFields(
            savedForm.fields.map((f: any, idx: number) => ({
              id: f.id,
              eventId: f.eventId,
              position: f.position !== undefined ? f.position : idx,
              type: f.type,
              label: f.label,
              helpText: f.helpText,
              required: f.required,
              options: f.options || [],
              validation: f.validation || {},
              version: f.version,
            }))
          );
        }
      }

      toast({
        type: 'success',
        title: 'Registration Form Saved',
        message: `Successfully updated form with ${fields.length} question(s).`,
      });

      if (onSaveSuccess) onSaveSuccess();
    } catch (err: any) {
      if (err?.error?.code === 'VERSION_CONFLICT') {
        toast({
          type: 'error',
          title: 'Version Conflict',
          message: 'This form was updated in another window. Refreshing latest version...',
        });
        fetchFormConfig();
      } else if (err?.error?.code === 'FORM_FROZEN') {
        toast({
          type: 'error',
          title: 'Form Locked',
          message: err.error.message || 'Cannot delete fields or change types once bookings exist.',
        });
      } else {
        toast({
          type: 'error',
          title: 'Save Error',
          message: err?.error?.message || err.message || 'Could not save registration form.',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <RefreshCw className="w-6 h-6 animate-spin text-brand" />
        <p className="text-xs text-text-muted">Loading custom registration form...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Controls & Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface p-4 rounded-lg border border-border">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-text">Registration Form Builder</h2>
            <Badge variant="neutral" size="sm">
              v{version}
            </Badge>
            {isFrozen && (
              <Badge variant="warning" size="sm" className="flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Locked ({registrationCount} Registrations)
              </Badge>
            )}
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Configure custom questionnaire, dietary requirements, and intake fields for attendees.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* Tab Switcher */}
          <div className="flex bg-surface-2 p-1 rounded-md border border-border text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1 font-semibold rounded transition-colors ${
                activeTab === 'editor'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              Editor
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1 font-semibold rounded transition-colors flex items-center gap-1.5 ${
                activeTab === 'preview'
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Live Preview
            </button>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSaveForm}
            isLoading={isSaving}
            className="flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            Save Form
          </Button>
        </div>
      </div>

      {/* Frozen Notice Banner */}
      {isFrozen && (
        <div className="p-3 bg-warning/10 border border-warning/20 rounded-md text-xs text-warning flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold">Structural Updates Restricted</p>
            <p className="text-text-muted mt-0.5">
              Because this event already has {registrationCount} recorded booking(s), existing questions cannot be deleted or have their types modified. You may safely add new questions, edit labels, or update validation rules.
            </p>
          </div>
        </div>
      )}

      {activeTab === 'preview' ? (
        /* Preview Mode */
        <Card className="p-6">
          <div className="max-w-xl mx-auto space-y-4">
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-bold text-text">Attendee Registration Preview</h3>
              <p className="text-xs text-text-muted">
                This is how questions will appear to students during checkout.
              </p>
            </div>

            {fields.length === 0 ? (
              <div className="text-center py-8 text-xs text-text-muted">
                No custom questions configured. Attendees will only be asked standard name & roll number.
              </div>
            ) : (
              <DynamicRegistrationForm
                fields={fields}
                answers={previewAnswers}
                onAnswerChange={(fieldId, val) =>
                  setPreviewAnswers((prev) => ({ ...prev, [fieldId]: val }))
                }
                ticketQuantity={1}
              />
            )}
          </div>
        </Card>
      ) : (
        /* Editor Mode */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left / Top: Field Type Palette */}
          <div className="lg:col-span-3 space-y-3">
            <Card className="p-3">
              <h3 className="text-xs font-bold text-text mb-2 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-brand" />
                Add Question Field
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-1 gap-1.5">
                {FORM_FIELD_TYPES.map((type) => {
                  const meta = FIELD_TYPE_METADATA[type];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleAddField(type)}
                      className="flex items-center gap-2 p-2 rounded text-xs font-medium text-left border border-border bg-surface hover:bg-surface-2 hover:border-brand/50 transition-colors"
                    >
                      <Icon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                      <span className="truncate">{meta.label}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Center: Reorderable Field List */}
          <div className="lg:col-span-5 space-y-3">
            <Card className="p-3">
              <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
                <h3 className="text-xs font-bold text-text">
                  Questions ({fields.length})
                </h3>
                <span className="text-[11px] text-text-muted">Drag or use arrows to reorder</span>
              </div>

              {fields.length === 0 ? (
                <div className="text-center py-10 text-xs text-text-muted border-2 border-dashed border-border rounded-lg p-4">
                  <p className="font-semibold text-text">No Custom Questions Yet</p>
                  <p className="mt-1">
                    Click any field type from the left palette to add standard dietary, contact, or survey questions.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {fields.map((field, index) => {
                    const meta = FIELD_TYPE_METADATA[field.type];
                    const Icon = meta?.icon || Type;
                    const isSelected = field.id === selectedFieldId;

                    return (
                      <div
                        key={field.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                        onClick={() => setSelectedFieldId(field.id || null)}
                        className={`group p-2.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-brand/5 border-brand ring-1 ring-brand'
                            : 'bg-surface border-border hover:border-text-muted/40'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {/* Drag Handle */}
                          <div
                            className="cursor-grab active:cursor-grabbing text-text-muted hover:text-text p-0.5"
                            title="Drag to reorder"
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </div>

                          <div className="w-5 h-5 rounded bg-surface-2 flex items-center justify-center text-[10px] font-bold text-text-muted flex-shrink-0">
                            {index + 1}
                          </div>

                          <Icon className="w-4 h-4 text-text-muted flex-shrink-0" />

                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-text truncate">
                              {field.label || 'Untitled Question'}
                              {field.required && (
                                <span className="text-error ml-1 font-bold">*</span>
                              )}
                            </p>
                            <p className="text-[10px] text-text-muted capitalize">
                              {field.type.replace('_', ' ')}
                            </p>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Move field ${index + 1} up`}
                            disabled={index === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveField(index, 'up');
                            }}
                            className="p-1 text-text-muted hover:text-text disabled:opacity-20 rounded"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Move field ${index + 1} down`}
                            disabled={index === fields.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMoveField(index, 'down');
                            }}
                            className="p-1 text-text-muted hover:text-text disabled:opacity-20 rounded"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Duplicate field"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDuplicateField(field);
                            }}
                            className="p-1 text-text-muted hover:text-text rounded"
                            title="Duplicate"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete field"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteField(field.id!);
                            }}
                            className="p-1 text-text-muted hover:text-error rounded"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          {/* Right: Field Settings Inspector */}
          <div className="lg:col-span-4 space-y-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 border-b border-border pb-2.5 mb-3">
                <Settings className="w-4 h-4 text-brand" />
                <h3 className="text-xs font-bold text-text">Field Configuration</h3>
              </div>

              {!selectedField ? (
                <div className="text-center py-10 text-xs text-text-muted">
                  Select a question from the list to customize its label, validation rules, and options.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Field Type Badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-muted">Field Type</span>
                    <Badge variant="neutral" size="sm" className="capitalize">
                      {selectedField.type.replace('_', ' ')}
                    </Badge>
                  </div>

                  {/* Question Label */}
                  <Input
                    label="Question Label"
                    value={selectedField.label}
                    onChange={(e) => updateSelectedField({ label: e.target.value })}
                    placeholder="e.g. Dietary Preference or T-Shirt Size"
                    required
                  />

                  {/* Help Text */}
                  <Textarea
                    label="Help / Description Text"
                    value={selectedField.helpText || ''}
                    onChange={(e) => updateSelectedField({ helpText: e.target.value })}
                    placeholder="Optional guidance shown under the input"
                    rows={2}
                  />

                  {/* Required Switch */}
                  <div className="pt-2 border-t border-border">
                    <Switch
                      label="Mandatory Question"
                      description="Attendees must provide an answer to complete registration"
                      checked={selectedField.required}
                      onChange={(checked) => updateSelectedField({ required: checked })}
                    />
                  </div>

                  {/* Options Editor (Dropdown, Radio, Multi-Checkbox, Dietary) */}
                  {['dropdown', 'radio', 'multi_checkbox', 'dietary'].includes(
                    selectedField.type
                  ) && (
                    <div className="space-y-2.5 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-text">
                          Allowed Options
                        </label>
                        {selectedField.type === 'dietary' && (
                          <button
                            type="button"
                            onClick={() =>
                              updateSelectedField({ options: [...DEFAULT_DIETARY_OPTIONS] })
                            }
                            className="text-[11px] text-brand hover:underline"
                          >
                            Reset Defaults
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {selectedField.options.map((opt, optIdx) => (
                          <div key={optIdx} className="flex items-center gap-1.5">
                            <Input
                              value={opt}
                              onChange={(e) => {
                                const newOpts = [...selectedField.options];
                                newOpts[optIdx] = e.target.value;
                                updateSelectedField({ options: newOpts });
                              }}
                              className="text-xs py-1 h-8"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newOpts = selectedField.options.filter(
                                  (_, i) => i !== optIdx
                                );
                                updateSelectedField({ options: newOpts });
                              }}
                              className="p-1 text-text-muted hover:text-error"
                              title="Remove option"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Add Option Input */}
                      <div className="flex items-center gap-1.5 pt-1">
                        <Input
                          placeholder="New option name..."
                          value={newOptionInput}
                          onChange={(e) => setNewOptionInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (newOptionInput.trim()) {
                                updateSelectedField({
                                  options: [...selectedField.options, newOptionInput.trim()],
                                });
                                setNewOptionInput('');
                              }
                            }
                          }}
                          className="text-xs py-1 h-8"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (newOptionInput.trim()) {
                              updateSelectedField({
                                options: [...selectedField.options, newOptionInput.trim()],
                              });
                              setNewOptionInput('');
                            }
                          }}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Number limits */}
                  {selectedField.type === 'number' && (
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
                      <Input
                        type="number"
                        label="Min Value"
                        value={selectedField.validation?.min ?? ''}
                        onChange={(e) =>
                          updateSelectedField({
                            validation: {
                              ...selectedField.validation,
                              min: e.target.value ? parseFloat(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                      <Input
                        type="number"
                        label="Max Value"
                        value={selectedField.validation?.max ?? ''}
                        onChange={(e) =>
                          updateSelectedField({
                            validation: {
                              ...selectedField.validation,
                              max: e.target.value ? parseFloat(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </div>
                  )}

                  {/* Regex pattern for text fields */}
                  {['short_text', 'long_text'].includes(selectedField.type) && (
                    <div className="space-y-2 pt-2 border-t border-border">
                      <Input
                        label="Custom Regex Pattern (Optional)"
                        placeholder="e.g. ^[A-Z]{3}[0-9]{3}$"
                        value={selectedField.validation?.pattern || ''}
                        onChange={(e) =>
                          updateSelectedField({
                            validation: {
                              ...selectedField.validation,
                              pattern: e.target.value || undefined,
                            },
                          })
                        }
                      />
                      <Input
                        label="Validation Error Message"
                        placeholder="e.g. Must match ABC123 format"
                        value={selectedField.validation?.errorMessage || ''}
                        onChange={(e) =>
                          updateSelectedField({
                            validation: {
                              ...selectedField.validation,
                              errorMessage: e.target.value || undefined,
                            },
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};
