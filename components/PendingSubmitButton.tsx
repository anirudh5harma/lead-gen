"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Icon from "@/components/Icon";

type PendingSubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  iconSize?: number;
  pending?: boolean;
  pendingLabel?: ReactNode;
};

export default function PendingSubmitButton({
  children,
  className = "",
  disabled,
  icon,
  iconSize = 16,
  pending: pendingOverride,
  pendingLabel,
  type = "submit",
  ...props
}: PendingSubmitButtonProps) {
  const status = useFormStatus();
  const pending = pendingOverride ?? status.pending;

  return (
    <button
      {...props}
      type={type}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {pending ? (
        <span className="pending-submit-spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={iconSize} />
      ) : null}
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
