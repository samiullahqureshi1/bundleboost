import type { ReactNode } from "react";

export function EmptyState({
  heading,
  children,
  action,
}: {
  heading: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <s-box padding="large-200">
      <s-stack direction="block" gap="base" alignItems="center">
        <s-icon type="discount" />
        <s-heading>{heading}</s-heading>
        <s-paragraph color="subdued">{children}</s-paragraph>
        {action}
      </s-stack>
    </s-box>
  );
}
