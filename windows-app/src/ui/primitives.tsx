import {
  Children,
  cloneElement,
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    loading = false,
    loadingLabel = '正在处理',
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={classes('ui-button', `ui-button--${variant}`, className)}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : null}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
});

interface FieldContract {
  readonly label: string;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'aria-invalid'>, FieldContract {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, description, error, id, className, ...props },
  ref,
) {
  const identity = useFieldIdentity(id, description, error);
  return (
    <FieldFrame {...identity} label={label} description={description} error={error}>
      <input
        {...props}
        ref={ref}
        id={identity.controlId}
        className={classes('ui-field__control', className)}
        aria-describedby={identity.describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
    </FieldFrame>
  );
});

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'aria-invalid'>, FieldContract {}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, description, error, id, className, ...props },
  ref,
) {
  const identity = useFieldIdentity(id, description, error);
  return (
    <FieldFrame {...identity} label={label} description={description} error={error}>
      <textarea
        {...props}
        ref={ref}
        id={identity.controlId}
        className={classes('ui-field__control', className)}
        aria-describedby={identity.describedBy}
        aria-invalid={error === undefined ? undefined : true}
      />
    </FieldFrame>
  );
});

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'aria-invalid'>, FieldContract {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, description, error, id, className, children, ...props },
  ref,
) {
  const identity = useFieldIdentity(id, description, error);
  return (
    <FieldFrame {...identity} label={label} description={description} error={error}>
      <select
        {...props}
        ref={ref}
        id={identity.controlId}
        className={classes('ui-field__control', className)}
        aria-describedby={identity.describedBy}
        aria-invalid={error === undefined ? undefined : true}
      >
        {children}
      </select>
    </FieldFrame>
  );
});

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly title?: string;
  readonly description?: string;
  readonly footer?: ReactNode;
}

export function Card({ title, description, footer, className, children, ...props }: CardProps) {
  const titleId = useId();
  return (
    <section
      {...props}
      className={classes('ui-card', className)}
      aria-labelledby={title === undefined ? undefined : titleId}
    >
      {title === undefined ? null : (
        <header className="ui-card__header">
          <h2 id={titleId}>{title}</h2>
          {description === undefined ? null : <p>{description}</p>}
        </header>
      )}
      <div className="ui-card__content">{children}</div>
      {footer === undefined ? null : <footer className="ui-card__footer">{footer}</footer>}
    </section>
  );
}

interface OverlayProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly closeLabel?: string;
  readonly onClose: () => void;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

export function Modal(props: OverlayProps) {
  return <Overlay {...props} kind="modal" />;
}

export function Drawer(props: OverlayProps) {
  return <Overlay {...props} kind="drawer" />;
}

interface OverlayImplementationProps extends OverlayProps {
  readonly kind: 'modal' | 'drawer';
}

function Overlay({
  open,
  title,
  description,
  closeLabel = '关闭',
  onClose,
  initialFocusRef,
  children,
  footer,
  kind,
}: OverlayImplementationProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(
    () => () => {
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open) {
      if (!dialog.open) {
        returnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      }
      const focusTarget =
        initialFocusRef?.current ??
        dialog.querySelector<HTMLElement>('button, input, textarea, select, [tabindex="0"]');
      focusTarget?.focus();
    } else if (dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    }
  }, [initialFocusRef, open]);

  return (
    <dialog
      ref={dialogRef}
      className={classes('ui-dialog', `ui-dialog--${kind}`)}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-modal={open ? true : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ui-dialog__surface">
        <header className="ui-dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description === undefined ? null : <p id={descriptionId}>{description}</p>}
          </div>
          <Button variant="quiet" aria-label={closeLabel} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </Button>
        </header>
        <div className="ui-dialog__content">{children}</div>
        {footer === undefined ? null : <footer className="ui-dialog__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

export interface TabItem {
  readonly id: string;
  readonly label: string;
  readonly panel: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly activeId: string;
  readonly onChange: (id: string) => void;
}

export function Tabs({ label, tabs, activeId, onChange }: TabsProps) {
  const identity = useId();
  const enabled = tabs.filter(({ disabled }) => disabled !== true);
  if (enabled.length === 0 || !enabled.some(({ id }) => id === activeId)) {
    throw new TypeError('Tabs require an enabled active item');
  }
  const activate = (id: string) => {
    onChange(id);
    document.getElementById(`${identity}-${id}-tab`)?.focus();
  };
  const activateRelative = (currentId: string, direction: number) => {
    const current = enabled.findIndex(({ id }) => id === currentId);
    const next = enabled[(current + direction + enabled.length) % enabled.length];
    if (next !== undefined) activate(next.id);
  };
  return (
    <div className="ui-tabs">
      <div className="ui-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`${identity}-${tab.id}-tab`}
            type="button"
            role="tab"
            disabled={tab.disabled}
            aria-selected={tab.id === activeId}
            aria-controls={`${identity}-${tab.id}-panel`}
            tabIndex={tab.id === activeId ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                activateRelative(tab.id, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                activateRelative(tab.id, -1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                const first = enabled[0];
                if (first !== undefined) activate(first.id);
              } else if (event.key === 'End') {
                event.preventDefault();
                const last = enabled.at(-1);
                if (last !== undefined) activate(last.id);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${identity}-${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${identity}-${tab.id}-tab`}
          hidden={tab.id !== activeId}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}

export interface TooltipProps {
  readonly content: string;
  readonly children: ReactElement<{ 'aria-describedby'?: string }>;
}

export function Tooltip({ content, children }: TooltipProps) {
  const identity = useId();
  const trigger = Children.only(children);
  const describedBy = [trigger.props['aria-describedby'], identity].filter(Boolean).join(' ');
  return (
    <span className="ui-tooltip">
      {cloneElement(trigger, { 'aria-describedby': describedBy })}
      <span id={identity} className="ui-tooltip__content" role="tooltip">
        {content}
      </span>
    </span>
  );
}

export interface ToastProps {
  readonly title: string;
  readonly description?: string;
  readonly tone?: 'info' | 'success' | 'error';
  readonly action?: ReactNode;
}

export function Toast({ title, description, tone = 'info', action }: ToastProps) {
  return (
    <aside
      className={classes('ui-toast', `ui-toast--${tone}`)}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <div>
        <strong>{title}</strong>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {action}
    </aside>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  readonly label: string;
  readonly lines?: number;
}

export function Skeleton({ label, lines = 3, className, ...props }: SkeletonProps) {
  if (!Number.isSafeInteger(lines) || lines < 1 || lines > 12) {
    throw new TypeError('Skeleton lines must be between 1 and 12');
  }
  return (
    <div {...props} className={classes('ui-skeleton', className)} aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      <div aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}

export interface ProgressProps {
  readonly label: string;
  readonly value: number;
  readonly max?: number;
  readonly description?: string;
}

export function Progress({ label, value, max = 100, description }: ProgressProps) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value < 0 || value > max) {
    throw new TypeError('Progress value is invalid');
  }
  const identity = useId();
  return (
    <div className="ui-progress">
      <div>
        <label htmlFor={identity}>{label}</label>
        <span aria-hidden="true">{Math.round((value / max) * 100)}%</span>
      </div>
      <progress id={identity} value={value} max={max} />
      {description === undefined ? null : <p>{description}</p>}
    </div>
  );
}

interface StateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, description, action }: StateProps) {
  return (
    <section className="ui-state ui-state--empty">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}

export interface ErrorStateProps extends StateProps {
  readonly code?: string;
}

export function ErrorState({ title, description, code, action }: ErrorStateProps) {
  return (
    <section className="ui-state ui-state--error" role="alert">
      <h2>{title}</h2>
      <p>{description}</p>
      {code === undefined ? null : <code>{code}</code>}
      {action}
    </section>
  );
}

interface FieldIdentity {
  readonly controlId: string;
  readonly descriptionId: string;
  readonly errorId: string;
  readonly describedBy: string | undefined;
}

function useFieldIdentity(
  id: string | undefined,
  description: string | undefined,
  error: string | undefined,
): FieldIdentity {
  const generated = useId();
  const controlId = id ?? generated;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    description === undefined ? null : descriptionId,
    error === undefined ? null : errorId,
  ]
    .filter(Boolean)
    .join(' ');
  return { controlId, descriptionId, errorId, describedBy: describedBy || undefined };
}

interface FieldFrameProps extends FieldContract, FieldIdentity {
  readonly children: ReactNode;
}

function FieldFrame({
  label,
  description,
  error,
  controlId,
  descriptionId,
  errorId,
  children,
}: FieldFrameProps) {
  return (
    <div className="ui-field">
      <label htmlFor={controlId}>{label}</label>
      {children}
      {description === undefined ? null : <p id={descriptionId}>{description}</p>}
      {error === undefined ? null : (
        <p id={errorId} className="ui-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function classes(...values: readonly (string | undefined)[]) {
  return values.filter(Boolean).join(' ');
}
