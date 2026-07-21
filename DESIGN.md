---
version: "alpha"
name: Futbots Match Intelligence
description: A compact football match intelligence console for scanning fixtures, imported evidence, and model predictions.
colors:
  primary: "#182218"
  ink: "#182218"
  paper: "#F5F3ED"
  surface: "#FFFFFF"
  surface-muted: "#E8E6DE"
  accent: "#EF6C4D"
  signal: "#2F8F68"
  warning: "#C8892C"
  line: "#D5D5CA"
  muted: "#68716A"
typography:
  display:
    fontFamily: "Arial, Microsoft YaHei, sans-serif"
    fontSize: "6.8rem"
    fontWeight: 900
    lineHeight: 0.95
    letterSpacing: "0em"
  heading:
    fontFamily: "Arial, Microsoft YaHei, sans-serif"
    fontSize: "1.45rem"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "0em"
  body:
    fontFamily: "Arial, Microsoft YaHei, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 500
    lineHeight: 1.55
    letterSpacing: "0em"
rounded:
  sm: "4px"
  md: "8px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  primary-button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  evidence-badge:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
---

## Overview

Futbots is a match intelligence console, not a marketing page. The visual language combines a warm paper workspace with dark ink typography and coral action signals. The first viewport should help a user scan the next fixtures, select a competition, and understand which evidence is actually available before running a model.

## Colors

Use warm paper and white surfaces as the base. Coral is reserved for primary actions and the selected match. Green indicates verified or available evidence. Amber means the data exists but should be refreshed near kickoff. Keep body text dark enough for scanning and avoid low-contrast gray-on-gray labels.

## Typography

Use a bold grotesk-style system stack for fixture names and section headings. Keep labels short, sentence case, and readable at compact dashboard sizes. Do not use decorative display text inside data modules.

## Layout

Use full-width workspace bands with a constrained inner column. Fixture cards are repeated records; data modules are unframed sections within the selected match view. The desktop grid should support side-by-side comparison and collapse to one column on narrow screens.

## Elevation & Depth

Prefer borders and surface contrast over heavy shadows. Use a small shadow only for the fixed navigation and modal. The selected fixture uses an accent border and a pale accent wash, never a gradient.

## Shapes

Use 4px controls and 8px framed records. Avoid pill-shaped containers except compact evidence/status badges.

## Components

Primary actions use coral. Secondary actions use paper or white with a clear border. Evidence badges must state whether player information, odds, experts, or lineups were actually captured.

## Do's and Don'ts

- Do show the count and status of captured player records.
- Do distinguish shared background schedule data from user-imported match evidence.
- Do keep prediction controls close to the selected match evidence.
- Don't imply player data exists based only on the kickoff time.
- Don't hide missing data behind a generic success state.
