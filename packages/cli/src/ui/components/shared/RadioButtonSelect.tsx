/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, Box } from 'ink';
import { Colors } from '../../colors.js';
import { useKeypress, type Key, stopPropagation } from '../../hooks/useKeypress.js';

/**
 * Represents a single option for the RadioButtonSelect.
 * Requires a label for display and a value to be returned on selection.
 */
export interface RadioSelectItem<T> {
  label: string;
  value: T;
  disabled?: boolean;
  themeNameDisplay?: string;
  themeTypeDisplay?: string;
}

/**
 * Props for the RadioButtonSelect component.
 * @template T The type of the value associated with each radio item.
 */
export interface RadioButtonSelectProps<T> {
  /** An array of items to display as radio options. */
  items: Array<RadioSelectItem<T>>;
  /** The initial index selected */
  initialIndex?: number;
  /** Function called when an item is selected. Receives the `value` of the selected item. */
  onSelect: (value: T) => void;
  /** Function called when an item is highlighted. Receives the `value` of the selected item. */
  onHighlight?: (value: T) => void;
  /** Whether this select input is currently focused and should respond to input. */
  isFocused?: boolean;
  /** Whether to show the scroll arrows. */
  showScrollArrows?: boolean;
  /** The maximum number of items to show at once. */
  maxItemsToShow?: number;
}

/**
 * A custom component that displays a list of items with radio buttons,
 * supporting scrolling and keyboard navigation.
 *
 * @template T The type of the value associated with each radio item.
 */
export function RadioButtonSelect<T>({
  items,
  initialIndex = 0,
  onSelect,
  onHighlight,
  isFocused,
  showScrollArrows = false,
  maxItemsToShow = 10,
}: RadioButtonSelectProps<T>): React.JSX.Element {
  // Ensure initialIndex is within bounds
  const safeInitialIndex =
    items.length > 0
      ? Math.max(0, Math.min(initialIndex, items.length - 1))
      : 0;
  const [activeIndex, setActiveIndex] = useState(safeInitialIndex);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Compute visible items with useMemo to stabilize reference
  const visibleItems = useMemo(
    () => items.slice(scrollOffset, scrollOffset + maxItemsToShow),
    [items, scrollOffset, maxItemsToShow]
  );

  // Ensure activeIndex is always within bounds when items change
  useEffect(() => {
    if (items.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= items.length) {
      setActiveIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, activeIndex]);

  useEffect(() => {
    const newScrollOffset = Math.max(
      0,
      Math.min(activeIndex - maxItemsToShow + 1, items.length - maxItemsToShow),
    );
    if (activeIndex < scrollOffset) {
      setScrollOffset(activeIndex);
    } else if (activeIndex >= scrollOffset + maxItemsToShow) {
      setScrollOffset(newScrollOffset);
    }
  }, [activeIndex, items.length, scrollOffset, maxItemsToShow]);

  // Memoize the input handler to prevent unnecessary re-registrations
  const handleInput = useCallback(
    (key: Key) => {
      if (key.name === 'up') {
        if (items.length > 0) {
          const newIndex = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
          setActiveIndex(newIndex);
          if (items[newIndex]) {
            onHighlight?.(items[newIndex].value);
          }
        }
        stopPropagation();
        return;
      }
      if (key.name === 'down') {
        if (items.length > 0) {
          const newIndex = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
          setActiveIndex(newIndex);
          if (items[newIndex]) {
            onHighlight?.(items[newIndex].value);
          }
        }
        stopPropagation();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        if (
          activeIndex >= 0 &&
          activeIndex < items.length &&
          items[activeIndex]
        ) {
          // Wrap in Promise.resolve to handle both sync and async onConfirm
          // callbacks. Without this, a rejected async onConfirm would be an
          // unhandled promise rejection, leaving the tool stuck in
          // awaiting_approval indefinitely.
          Promise.resolve(onSelect(items[activeIndex].value)).catch(
            (err: unknown) => {
              console.error('[RadioButtonSelect] onConfirm rejected:', err);
            },
          );
        }
        stopPropagation();
        return;
      }

      // Enable selection directly from number keys.
      if (/^[1-9]$/.test(key.sequence)) {
        const targetIndex = Number.parseInt(key.sequence, 10) - 1;
        const currentVisibleItems = items.slice(scrollOffset, scrollOffset + maxItemsToShow);
        if (targetIndex >= 0 && targetIndex < currentVisibleItems.length) {
          const selectedItem = currentVisibleItems[targetIndex];
          if (selectedItem) {
            Promise.resolve(onSelect(selectedItem.value)).catch(
              (err: unknown) => {
                console.error('[RadioButtonSelect] onConfirm rejected:', err);
              },
            );
          }
        }
        stopPropagation();
        return;
      }
    },
    [items, activeIndex, scrollOffset, maxItemsToShow, onSelect, onHighlight]
  );

  useKeypress(handleInput, {
    isActive:
      !!isFocused &&
      items.length > 0 &&
      activeIndex >= 0 &&
      activeIndex < items.length,
    priority: 50,
  });

  return (
    <Box flexDirection="column">
      {showScrollArrows && (
        <Text color={scrollOffset > 0 ? Colors.Foreground : Colors.Gray}>
          ▲
        </Text>
      )}
      {visibleItems.map((item, index) => {
        const itemIndex = scrollOffset + index;
        const isSelected = activeIndex === itemIndex;

        let textColor = Colors.Foreground;
        if (isSelected) {
          textColor = Colors.AccentGreen;
        } else if (item.disabled) {
          textColor = Colors.Gray;
        }

        return (
          <Box key={item.label}>
            <Box minWidth={2} flexShrink={0}>
              <Text color={isSelected ? Colors.AccentGreen : Colors.Foreground}>
                {index + 1}
              </Text>
            </Box>
            {item.themeNameDisplay && item.themeTypeDisplay ? (
              <Text color={textColor} wrap="truncate">
                {item.themeNameDisplay}{' '}
                <Text color={Colors.Gray}>{item.themeTypeDisplay}</Text>
              </Text>
            ) : (
              <Text color={textColor} wrap="truncate">
                {item.label}
              </Text>
            )}
          </Box>
        );
      })}
      {showScrollArrows && (
        <Text
          color={
            scrollOffset + maxItemsToShow < items.length
              ? Colors.Foreground
              : Colors.Gray
          }
        >
          ▼
        </Text>
      )}
    </Box>
  );
}
