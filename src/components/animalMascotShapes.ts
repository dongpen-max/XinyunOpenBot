import type { CursorShape } from "./CursorAvatar";

export type AnimalMausShape =
  | "cat"
  | "rabbit"
  | "fox"
  | "bear"
  | "panda"
  | "owl"
  | "dog"
  | "dragon";

export type AnimalMascotShape = {
  id: AnimalMausShape;
  label: string;
  shape: CursorShape;
};

const artwork = (
  name: AnimalMausShape,
  body: string,
  clip: string,
  anchor: CursorShape["anchor"],
): CursorShape => ({ name, fit: "", body, clip, anchor });

const gradient = (markup: string) => markup.replaceAll("{{FILL}}", "{{GRADIENT}}");

/**
 * Animal silhouettes authored for Blob Studio's 228-unit face box.
 *
 * Each animal is a single animated artwork group: ears, horns and wings travel
 * with the body instead of being separate DOM decorations. The clip only uses
 * the outer silhouette so all existing expressions remain interchangeable.
 */
export const ANIMAL_MASCOT_SHAPES: AnimalMascotShape[] = [
  {
    id: "cat",
    label: "猫咪",
    shape: artwork(
      "cat",
      gradient(`
        <path d="M45 84 52 23 91 53c15-5 31-5 46 0l39-30 7 61c17 19 23 45 16 70-9 35-40 57-85 57s-76-22-85-57c-7-25-1-51 16-70Z" fill="{{FILL}}"/>
        <path d="m58 42 25 19-29 13 4-32Zm112 0-25 19 29 13-4-32Z" fill="#ffffff" opacity=".2"/>
        <path d="M48 154 14 145m36 25-35 4m165-20 34-9m-36 25 35 4" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="5" opacity=".62"/>
      `),
      `<path d="M45 84 52 23 91 53c15-5 31-5 46 0l39-30 7 61c17 19 23 45 16 70-9 35-40 57-85 57s-76-22-85-57c-7-25-1-51 16-70Z"/>`,
      { x: 114, y: 125, scale: 0.57 },
    ),
  },
  {
    id: "rabbit",
    label: "兔子",
    shape: artwork(
      "rabbit",
      gradient(`
        <ellipse cx="78" cy="59" rx="25" ry="56" transform="rotate(-8 78 59)" fill="{{FILL}}"/>
        <ellipse cx="150" cy="59" rx="25" ry="56" transform="rotate(8 150 59)" fill="{{FILL}}"/>
        <ellipse cx="114" cy="142" rx="88" ry="73" fill="{{FILL}}"/>
        <ellipse cx="78" cy="58" rx="10" ry="39" transform="rotate(-8 78 58)" fill="#ffffff" opacity=".22"/>
        <ellipse cx="150" cy="58" rx="10" ry="39" transform="rotate(8 150 58)" fill="#ffffff" opacity=".22"/>
      `),
      `<ellipse cx="78" cy="59" rx="25" ry="56" transform="rotate(-8 78 59)"/><ellipse cx="150" cy="59" rx="25" ry="56" transform="rotate(8 150 59)"/><ellipse cx="114" cy="142" rx="88" ry="73"/>`,
      { x: 114, y: 145, scale: 0.55 },
    ),
  },
  {
    id: "fox",
    label: "狐狸",
    shape: artwork(
      "fox",
      gradient(`
        <path d="M29 75 49 18 91 51c15-5 31-5 46 0l42-33 20 57c11 30 8 63-9 89-18 27-45 45-76 56-31-11-58-29-76-56-17-26-20-59-9-89Z" fill="{{FILL}}"/>
        <path d="M37 78 53 34l28 24-44 20Zm154 0-16-44-28 24 44 20Z" fill="#172033" opacity=".34"/>
        <path d="M43 139c19 7 36 18 52 33l19 42-38-20c-22-12-36-30-43-54l10-1Zm142 0c-19 7-36 18-52 33l-19 42 38-20c22-12 36-30 43-54l-10-1Z" fill="#ffffff" opacity=".2"/>
      `),
      `<path d="M29 75 49 18 91 51c15-5 31-5 46 0l42-33 20 57c11 30 8 63-9 89-18 27-45 45-76 56-31-11-58-29-76-56-17-26-20-59-9-89Z"/>`,
      { x: 114, y: 122, scale: 0.55 },
    ),
  },
  {
    id: "bear",
    label: "小熊",
    shape: artwork(
      "bear",
      gradient(`
        <circle cx="54" cy="55" r="34" fill="{{FILL}}"/>
        <circle cx="174" cy="55" r="34" fill="{{FILL}}"/>
        <ellipse cx="114" cy="132" rx="91" ry="81" fill="{{FILL}}"/>
        <circle cx="54" cy="55" r="16" fill="#172033" opacity=".22"/>
        <circle cx="174" cy="55" r="16" fill="#172033" opacity=".22"/>
        <ellipse cx="114" cy="168" rx="38" ry="27" fill="#ffffff" opacity=".16"/>
      `),
      `<circle cx="54" cy="55" r="34"/><circle cx="174" cy="55" r="34"/><ellipse cx="114" cy="132" rx="91" ry="81"/>`,
      { x: 114, y: 126, scale: 0.61 },
    ),
  },
  {
    id: "panda",
    label: "熊猫",
    shape: artwork(
      "panda",
      gradient(`
        <circle cx="51" cy="53" r="34" fill="#172033"/>
        <circle cx="177" cy="53" r="34" fill="#172033"/>
        <ellipse cx="114" cy="132" rx="91" ry="81" fill="{{FILL}}"/>
        <ellipse cx="78" cy="119" rx="25" ry="32" transform="rotate(24 78 119)" fill="#172033" opacity=".86"/>
        <ellipse cx="150" cy="119" rx="25" ry="32" transform="rotate(-24 150 119)" fill="#172033" opacity=".86"/>
        <ellipse cx="114" cy="172" rx="35" ry="24" fill="#ffffff" opacity=".18"/>
      `),
      `<circle cx="51" cy="53" r="34"/><circle cx="177" cy="53" r="34"/><ellipse cx="114" cy="132" rx="91" ry="81"/>`,
      { x: 114, y: 126, scale: 0.58 },
    ),
  },
  {
    id: "owl",
    label: "猫头鹰",
    shape: artwork(
      "owl",
      gradient(`
        <path d="M26 64 57 25l24 30c21-10 45-10 66 0l24-30 31 39-13 32c11 19 16 40 13 62-5 39-37 65-88 65s-83-26-88-65c-3-22 2-43 13-62L26 64Z" fill="{{FILL}}"/>
        <path d="M25 124c25 4 44 18 58 40l-15 43c-26-12-42-37-43-83Zm178 0c-25 4-44 18-58 40l15 43c26-12 42-37 43-83Z" fill="#172033" opacity=".2"/>
        <ellipse cx="78" cy="116" rx="34" ry="37" fill="#172033" opacity=".72"/>
        <ellipse cx="150" cy="116" rx="34" ry="37" fill="#172033" opacity=".72"/>
        <path d="m103 146 11 17 11-17-11-9-11 9Z" fill="#ffffff" opacity=".7"/>
        <path d="m82 181 16 11 16-11 16 11 16-11" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="5" opacity=".32"/>
      `),
      `<path d="M26 64 57 25l24 30c21-10 45-10 66 0l24-30 31 39-13 32c11 19 16 40 13 62-5 39-37 65-88 65s-83-26-88-65c-3-22 2-43 13-62L26 64Z"/>`,
      { x: 114, y: 119, scale: 0.57 },
    ),
  },
  {
    id: "dog",
    label: "小狗",
    shape: artwork(
      "dog",
      gradient(`
        <path d="M61 60C34 25 4 43 11 100c5 37 20 62 45 78l37-99-32-19Zm106 0c27-35 57-17 50 40-5 37-20 62-45 78l-37-99 32-19Z" fill="{{FILL}}"/>
        <path d="M54 55C36 41 24 50 25 85c1 29 10 51 27 67l20-77-18-20Zm120 0c18-14 30-5 29 30-1 29-10 51-27 67l-20-77 18-20Z" fill="#172033" opacity=".22"/>
        <ellipse cx="114" cy="130" rx="85" ry="82" fill="{{FILL}}"/>
        <ellipse cx="114" cy="166" rx="39" ry="29" fill="#ffffff" opacity=".16"/>
        <path d="M91 175c7 8 15 12 23 12s16-4 23-12" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="6" opacity=".42"/>
        <ellipse cx="114" cy="151" rx="16" ry="11" fill="#172033" opacity=".72"/>
      `),
      `<path d="M61 60C34 25 4 43 11 100c5 37 20 62 45 78l37-99-32-19Zm106 0c27-35 57-17 50 40-5 37-20 62-45 78l-37-99 32-19Z"/><ellipse cx="114" cy="130" rx="85" ry="82"/>`,
      { x: 114, y: 122, scale: 0.59 },
    ),
  },
  {
    id: "dragon",
    label: "小龙",
    shape: artwork(
      "dragon",
      gradient(`
        <path d="m49 77-18-52 49 28c10-6 21-10 34-11 13 1 24 5 34 11l49-28-18 52c16 18 24 41 23 66-2 39-31 68-70 75l-18-14-18 14c-39-7-68-36-70-75-1-25 7-48 23-66Z" fill="{{FILL}}"/>
        <path d="m65 63-22-25 32 18-10 7Zm98 0 22-25-32 18 10 7Z" fill="#ffffff" opacity=".22"/>
        <path d="m88 47 12-32 14 26 14-26 12 32" fill="{{FILL}}"/>
        <path d="M66 160c17 16 33 24 48 24s31-8 48-24" fill="none" stroke="#ffffff" stroke-linecap="round" stroke-width="6" opacity=".3"/>
      `),
      `<path d="m49 77-18-52 49 28c10-6 21-10 34-11 13 1 24 5 34 11l49-28-18 52c16 18 24 41 23 66-2 39-31 68-70 75l-18-14-18 14c-39-7-68-36-70-75-1-25 7-48 23-66Z"/><path d="m88 47 12-32 14 26 14-26 12 32Z"/>`,
      { x: 114, y: 122, scale: 0.55 },
    ),
  },
];
