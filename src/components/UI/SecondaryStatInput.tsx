import React, { useState, useEffect, FocusEvent, ChangeEvent } from 'react';
import { cn } from '../../lib/utils';

interface SecondaryStatInputProps {
    value: number; // The numeric value from parent state
    onChange: (value: number) => void; // Callback to update parent state with final number
    min?: number;
    max?: number;
    className?: string;
}

export const SecondaryStatInput: React.FC<SecondaryStatInputProps> = ({ value, onChange, min = 0, max = 100, className }) => {
    // Local state to handle string input allowing intermediate states like "19."
    const [localValue, setLocalValue] = useState<string>(value.toString());

    // Sync local state when parent value changes externally
    useEffect(() => {
        // Only update if the parsed local value is different to avoid cursor jumps or format wars
        // But if focus is elsewhere, we should sync.
        // Simple approach: When not focused, sync.
        // We can check document.activeElement, but let's just use a simple sync
        // and rely on onChange updating parent which updates value.
        // Actually, if we are typing, we don't want parent updates to overwrite "19." with "19"

        // Let's rely on local state for display, and push to parent on blur or valid change?
        // User wants to see "19."
        // If parent passed "19", local is "19".
        // If user types ".", local becomes "19.". Parent value doesn't change (still 19).
        // If user types "5", local becomes "19.5". Parent value becomes 19.5.
        // If parent passes 19.5, local becomes "19.5".

        // Issue: if parent update triggers re-render, localValue reset?
        // Only reset if numeric mismatch?
        if (parseFloat(localValue.replace(',', '.')) !== value && !isNaN(parseFloat(localValue.replace(',', '.')))) {
            setLocalValue(value.toString());
        }
    }, [value]);

    // Better approach: Derived state pattern is tricky with inputs.
    // Let's just initialize on focus? No, need to see updates.
    // Let's use a simpler "uncontrolled while focused" or just strict handling.

    // The previous issue was: Modals used `value` from state which was `string | number`.
    // Now we want the parent to deal with `number`.

    const [inputValue, setInputValue] = useState(String(value));

    useEffect(() => {
        // When parent value changes, update input ONLY if we are not editing it (managed by parent?)
        // Actually the parent modal re-renders on every change provided we call onChange.
        // If we call onChange(19.5), parent updates value to 19.5, passes it back.
        // If we type "19.", we CANNOT call onChange(19.) because valid number is 19.
        // So we must maintain local state for "19." and NOT call onChange yet? or call onChange(19)?
        // If we call onChange(19), parent sends 19. Input shows 19. Dot is lost.
        // SO: We must have local state that drives the input value.
        // We sync from props only when props change significantly or on blur.

        // But wait, if we have multiple inputs (mapped in parent), and we re-order them, key changes?
        // React keys should handle identity.

        // Let's just always sync from value UNLESS we are focusing? 
        // Standard pattern: controlled input. But formatted.
        // We can't use controlled input for "19." if value is number.
        // PROPOSAL: Use `localValue` state. Sync from `value` prop in `useEffect` ONLY IF `value` changes AND `Number(localValue) !== value` (approx).

        // Actually, simplest:
        // Always show localValue.
        // On Blur: parse localValue, clamp, call onChange(finalNumber), setLocalValue(finalNumber).
        // On Change: setLocalValue, valid number -> call onChange? Or wait for blur?
        // User said: "clicco sul valore non mi seleziona in automatico tutto il testo" -> select() on focus.
        // "se metto il . mi si resetta" -> because of controlled number input logic.

        setInputValue(String(value));
    }, [value]);

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        // Allow numeric chars, dot, comma
        if (/^[0-9.,]*$/.test(raw)) {
            setInputValue(raw);
            // Optionally push to parent if valid number?
            // If we push to parent, parent re-renders and might reset us if we depend on effect [value].
            // To avoid fighting: DON'T push to parent on every keystroke if it causes re-render of this component with parsed value.
            // BUT parent needs to update `manualStats` array in state.
            // If we don't push, parent state is stale. If we save, we assume parent state is up to date?
            // We need to push.
            // Solution: Parent should accept string or we parse. 
            // Better: We only push VALID COMPLETE numbers to parent on BLUR.
            // But if user clicks "Save" without blurring? "Save" button focus triggers blur on input? Yes.
            // So onBlur update is sufficiently safe for Mouse users. Input -> Save click -> Input Blur -> Parent Update -> Save Click (wait, race condition?)
            // If I click Save (mousedown), Input blurs. onChange fires. Parent state updates. Then Save (mouseup/click) fires.
            // USUALLY safe.

            // To be safer: Pass `ref` or similar? No.
            // Let's try pushing to parent immediately IF it doesn't break formatting.
            // "19." -> parse -> 19. Parent gets 19. Parent sends back 19. Input becomes "19". Dot lost.

            // CONCLUSION: Parent MUST store the string intermediate OR we block parent updates while editing?
            // The user wanted "min max e lo chiami lì".
            // Let's try: `value` is passed as `number`. 
            // We maintain `internalValue` string. 
            // We NEVER update parent during typing of "problematic" strings (empty, ending in dot).
            // We DO update parent if string is valid number that matches exact format?
            // Actually, if we just update parent on Blur, it solves the dot resetting.
            // AND fixes the "Save" race condition? 
            // If Input BLUR happens before Button CLICK. Yes.
        }
    };

    const onBlur = () => {
        let str = inputValue.replace(',', '.');
        let num = parseFloat(str);

        if (isNaN(num)) num = 0;

        // Clamp
        if (num < min) num = min;
        if (num > max) num = max;

        // Round to 2 decimals
        num = parseFloat(num.toFixed(2));

        // Update parent
        onChange(num);
        // Update local to pretty formatted
        setInputValue(String(num));
    };

    const onFocus = (e: FocusEvent<HTMLInputElement>) => {
        e.target.select();
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            className={cn(
                "w-16 bg-bg-input border border-border rounded px-2 py-1 text-xs font-mono",
                className
            )}
            value={inputValue}
            onChange={handleChange}
            onBlur={onBlur}
            onFocus={onFocus}
        />
    );
};
