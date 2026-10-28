/**
 * Client onboarding: the questions, in one place.
 *
 * Answers are stored as one JSON document per client (0055), keyed by the
 * field keys below, so changing a question is an edit here and nothing else.
 * Removing a field leaves its old answers in the document, unread; renaming a
 * key loses them, so add a new key instead.
 *
 * Passwords are never asked for. The access section asks which platforms the
 * client uses and has them add admin@hartwelldigital.com, which is safer for
 * them, revocable by them, and keeps credentials out of a database.
 */

export type FieldType = "text" | "textarea" | "url" | "tel" | "choice";

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  hint?: string;
  options?: string[];
  required?: boolean;
}

export interface Section {
  key: "business" | "goals" | "brand" | "access" | "kickoff";
  title: string;
  intro: string;
  fields: Field[];
}

export const SECTIONS: Section[] = [
  {
    key: "business",
    title: "Your business",
    intro: "The basics, so everything we make sounds like you and points people to the right place.",
    fields: [
      { key: "what_you_do", label: "What does your business do?", type: "textarea", placeholder: "A sentence or two, the way you'd say it to a customer", required: true },
      { key: "website", label: "Your website", type: "url", placeholder: "https://", hint: "Leave it blank if you don't have one yet." },
      { key: "phone", label: "The number customers should call", type: "tel" },
      { key: "area", label: "Where do you work?", type: "text", placeholder: "Suburbs, regions, or Australia wide", required: true },
      { key: "contact_pref", label: "Best way to reach you", type: "choice", options: ["The portal chat", "Email", "Phone"], required: true },
    ],
  },
  {
    key: "goals",
    title: "Customers and goals",
    intro: "Who you want more of, and what a good six months would look like.",
    fields: [
      { key: "best_customers", label: "Who are your best customers?", type: "textarea", placeholder: "Who they are, what they buy, why they pick you", required: true },
      { key: "goal", label: "What would make the next six months a success?", type: "textarea", placeholder: "More calls, more bookings, a site you're proud of…", required: true },
      { key: "measure", label: "How will we know it's working?", type: "text", placeholder: "e.g. 20 enquiries a month" },
      { key: "competitors", label: "Any competitors you keep an eye on?", type: "textarea", placeholder: "Names or websites" },
    ],
  },
  {
    key: "brand",
    title: "Your brand",
    intro: "What we have to work with. Your logo and photos go in Assets, linked below.",
    fields: [
      { key: "logo", label: "Do you have a logo?", type: "choice", options: ["Yes, and I'm happy with it", "Yes, but it needs work", "Not yet"], required: true },
      { key: "colours", label: "Brand colours or fonts", type: "text", placeholder: "Hex codes, names, or 'not sure'" },
      { key: "feel", label: "Three words for how your business should come across", type: "text", placeholder: "e.g. reliable, local, friendly" },
      { key: "avoid", label: "Anything you don't want?", type: "textarea", placeholder: "Colours, words, styles, competitors' looks" },
    ],
  },
  {
    key: "access",
    title: "Access",
    intro:
      "Never send passwords. For each platform you use, add admin@hartwelldigital.com as a user or manager, then tick it off here.",
    fields: [{ key: "access_notes", label: "Anything about access we should know?", type: "textarea", placeholder: "e.g. my web developer controls the domain" }],
  },
  {
    key: "kickoff",
    title: "Kickoff call",
    intro: "Half an hour to go through your answers, agree the plan and answer your questions.",
    fields: [],
  },
];

/** The platforms Kyle usually needs a way into, and where to add him. */
export const PLATFORMS: { key: string; name: string; how: string }[] = [
  { key: "gbp", name: "Google Business Profile", how: "Profile, then the three dots, Business Profile settings, Managers, Add" },
  { key: "ga", name: "Google Analytics", how: "Admin, then Property access management, the plus, Add users" },
  { key: "gsc", name: "Google Search Console", how: "Settings, then Users and permissions, Add user" },
  { key: "gads", name: "Google Ads", how: "Admin, then Access and security, the plus" },
  { key: "meta", name: "Meta (Facebook and Instagram)", how: "Meta Business Suite, Settings, People, Add people" },
  { key: "site", name: "Your website", how: "Add a user in your website's dashboard, or tell us who manages it" },
  { key: "domain", name: "Your domain name", how: "Tell us where it's registered; we'll talk you through it on the call" },
];

export type Answers = Record<string, unknown> & {
  access?: Record<string, { uses?: boolean; added?: boolean }>;
};

export function answerText(a: Answers, key: string): string {
  const v = a[key];
  return typeof v === "string" ? v : "";
}

/** Is this section done? Every required question answered. */
export function sectionDone(section: Section, a: Answers, kickoffBooked: boolean): boolean {
  if (section.key === "kickoff") return kickoffBooked;
  if (section.key === "access") {
    // Done when every platform they use has had Kyle added, and they've
    // looked at the list at all.
    const access = a.access ?? {};
    const used = Object.values(access).filter((x) => x?.uses);
    return Object.keys(access).length > 0 && used.every((x) => x.added);
  }
  return section.fields.filter((f) => f.required).every((f) => answerText(a, f.key).trim().length > 0);
}

export function progress(a: Answers, kickoffBooked: boolean): { done: number; total: number } {
  const done = SECTIONS.filter((s) => sectionDone(s, a, kickoffBooked)).length;
  return { done, total: SECTIONS.length };
}

/** What happens next, shown at the top of onboarding. */
export const NEXT_STEPS: { title: string; detail: string }[] = [
  { title: "Tell us about your business", detail: "This page. About ten minutes, saved as you go." },
  { title: "Kickoff call", detail: "Half an hour to agree the plan and the first jobs." },
  { title: "We get to work", detail: "Drafts land in Approvals for your OK before anything goes live." },
  { title: "Your first report", detail: "At the end of your first full month, and every month after." },
];

export const DEFAULT_WELCOME =
  "Thanks for choosing Hartwell Digital. This page gets you set up: a few questions about your business, the access I'll need, and a time for our kickoff call. It saves as you go, so come back to it whenever suits. If anything's unclear, message me from the chat bubble and I'll sort it out.";

/**
 * Onboarding applies to clients who joined recently or already started it.
 * A client who has been with Kyle for months should never be greeted as new.
 */
export const ONBOARDING_WINDOW_DAYS = 60;
