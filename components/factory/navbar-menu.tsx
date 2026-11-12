
"use client";

import React from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";

const transition = {
  type: "spring" as const,
  mass: 0.5,
  damping: 11.5,
  stiffness: 100,
  restDelta: 0.001,
  restSpeed: 0.001,
};

export const MenuItem = ({
  setActive,
  active,
  item,
  children,
}: {
  setActive: (item: string) => void;
  active: string | null;
  item: string;
  children?: React.ReactNode;
}) => {
  return (
    <div
      onMouseEnter={() => setActive(item)}
      className="relative"
    >
      <motion.p
        transition={{ duration: 0.3 }}
        className="cursor-pointer text-sm font-medium text-slate-700 transition hover:text-slate-950 dark:text-slate-200 dark:hover:text-white"
      >
        {item}
      </motion.p>

      {active !== null && (
        <motion.div
          initial={{
            opacity: 0,
            scale: 0.85,
            y: 10,
          }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
          }}
          transition={transition}
        >
          {active === item && (
            <div className="absolute left-1/2 top-[calc(100%_+_1.2rem)] -translate-x-1/2 pt-4">
              <motion.div
                layoutId="active"
                transition={transition}
                className="
                  overflow-hidden rounded-2xl
                  border border-black/[0.12]
                  bg-white shadow-xl backdrop-blur-sm
                  dark:border-white/[0.15]
                  dark:bg-slate-950
                "
              >
                <motion.div
                  layout
                  className="h-full w-max p-4"
                >
                  {children}
                </motion.div>
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export const Menu = ({
  setActive,
  children,
  className,
}: {
  setActive: (item: string | null) => void;
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <nav
      onMouseLeave={() => setActive(null)}
      className={cn(
        `
          relative flex w-full items-center justify-between
          rounded-2xl border border-black/[0.08]
          bg-white px-4 py-3
          shadow-lg
          transition-colors duration-300
          dark:border-white/10 dark:bg-slate-950
          sm:px-5
        `,
        className,
      )}
    >
      {children}
    </nav>
  );
};

export const ProductItem = ({
  title,
  description,
  href,
  src,
}: {
  title: string;
  description: string;
  href: string;
  src: string;
}) => {
  return (
    <a
      href={href}
      className="
        flex space-x-3 rounded-xl p-2
        transition hover:bg-slate-100
        dark:hover:bg-white/[0.07]
      "
    >
      <img
        src={src}
        width={120}
        height={72}
        alt={title}
        className="h-[72px] w-[120px] shrink-0 rounded-lg object-cover shadow-md"
      />

      <div>
        <h4 className="mb-1 text-base font-bold text-slate-950 dark:text-white">
          {title}
        </h4>

        <p className="max-w-[11rem] text-xs leading-5 text-slate-600 dark:text-slate-300">
          {description}
        </p>
      </div>
    </a>
  );
};

export const HoveredLink = ({
  children,
  className,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
  return (
    <a
      {...rest}
      className={cn(
        `
          text-sm text-slate-600
          transition hover:text-blue-600
          dark:text-slate-300
          dark:hover:text-blue-400
        `,
        className,
      )}
    >
      {children}
    </a>
  );
};