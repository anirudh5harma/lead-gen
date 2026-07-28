"use client";

import type { ComponentPropsWithoutRef, InputEvent } from "react";
import {
  normalizeWebsiteInputUrl,
  PUBLIC_WEBSITE_INPUT_PATTERN,
} from "@/lib/network/website-input";

const WEBSITE_VALIDATION_MESSAGE =
  "Enter a valid public company website like yourcompany.com";

export default function WebsiteUrlInput({
  onInput,
  ...props
}: ComponentPropsWithoutRef<"input">) {
  function validate(event: InputEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    input.setCustomValidity(
      input.value && !normalizeWebsiteInputUrl(input.value)
        ? WEBSITE_VALIDATION_MESSAGE
        : "",
    );
    onInput?.(event);
  }

  return (
    <input
      {...props}
      type="text"
      pattern={PUBLIC_WEBSITE_INPUT_PATTERN}
      title={WEBSITE_VALIDATION_MESSAGE}
      onInput={validate}
    />
  );
}
