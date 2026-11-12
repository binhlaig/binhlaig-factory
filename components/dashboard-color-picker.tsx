
"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";

type DashboardColor =
  | "blue"
  | "violet"
  | "emerald"
  | "rose"
  | "amber"
  | "indigo";

type ColorOption = {
  id: DashboardColor;
  title: string;
  preview: string;
};

const colorOptions: ColorOption[] = [
  {
    id: "blue",
    title: "Blue",
    preview: "bg-[#2563eb]",
  },
  {
    id: "violet",
    title: "Violet",
    preview: "bg-[#7c3aed]",
  },
  {
    id: "emerald",
    title: "Emerald",
    preview: "bg-[#059669]",
  },
  {
    id: "rose",
    title: "Rose",
    preview: "bg-[#e11d48]",
  },
  {
    id: "amber",
    title: "Amber",
    preview: "bg-[#d97706]",
  },
  {
    id: "indigo",
    title: "Indigo",
    preview: "bg-[#4f46e5]",
  },
];

const STORAGE_KEY = "pos-dashboard-color";

export function DashboardColorPicker() {
  const [selectedColor, setSelectedColor] =
    useState<DashboardColor>("blue");

  const [open, setOpen] = useState(false);

  useEffect(() => {
    const savedColor = localStorage.getItem(
      STORAGE_KEY,
    ) as DashboardColor | null;

    const validColor = colorOptions.some(
      (option) => option.id === savedColor,
    );

    const initialColor =
      savedColor && validColor
        ? savedColor
        : "blue";

    setSelectedColor(initialColor);

    document.documentElement.setAttribute(
      "data-dashboard-color",
      initialColor,
    );
  }, []);

  const handleColorChange = (
    color: DashboardColor,
  ) => {
    setSelectedColor(color);

    localStorage.setItem(
      STORAGE_KEY,
      color,
    );

    document.documentElement.setAttribute(
      "data-dashboard-color",
      color,
    );

    setOpen(false);
  };

  const selectedOption =
    colorOptions.find(
      (option) => option.id === selectedColor,
    ) ?? colorOptions[0];

  return (
    <div className="relative">
      {/* Current color circle */}
      <button
        type="button"
        aria-label={`Dashboard color: ${selectedOption.title}`}
        title={`Dashboard color: ${selectedOption.title}`}
        aria-expanded={open}
        onClick={() =>
          setOpen((previous) => !previous)
        }
        className="
          flex h-9 w-9 items-center justify-center
          rounded-xl
          transition-all duration-200
          hover:bg-slate-100
          active:scale-95
          dark:hover:bg-white/10
        "
      >
        <span
          className={`
            h-5 w-5 rounded-full
            border-2 border-white
            shadow-[0_0_0_1px_rgba(15,23,42,0.18)]
            transition-transform duration-200
            hover:scale-110
            dark:border-slate-950
            dark:shadow-[0_0_0_1px_rgba(255,255,255,0.25)]
            ${selectedOption.preview}
          `}
        />
      </button>

      {open && (
        <>
          {/* Click outside to close */}
          <button
            type="button"
            aria-label="Close color menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-[70]"
          />

          {/* Color menu */}
          <div
            className="
              absolute right-0
              top-[calc(100%+12px)]
              z-[80] w-48
              rounded-2xl
              border border-slate-200
              bg-white p-2 shadow-xl
              dark:border-white/10
              dark:bg-slate-950
            "
          >
            <p className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Dashboard color
            </p>

            <div className="space-y-1">
              {colorOptions.map((option) => {
                const isSelected =
                  selectedColor === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      handleColorChange(option.id)
                    }
                    className={`
                      flex w-full items-center gap-3
                      rounded-xl px-2 py-2
                      text-left text-xs
                      transition
                      ${
                        isSelected
                          ? "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300"
                          : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/10"
                      }
                    `}
                  >
                    <span
                      className={`
                        h-5 w-5 shrink-0
                        rounded-full
                        border-2 border-white
                        shadow-[0_0_0_1px_rgba(15,23,42,0.15)]
                        dark:border-slate-950
                        dark:shadow-[0_0_0_1px_rgba(255,255,255,0.2)]
                        ${option.preview}
                      `}
                    />

                    <span className="flex-1">
                      {option.title}
                    </span>

                    {isSelected && (
                      <Check
                        size={15}
                        className="text-blue-600"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}