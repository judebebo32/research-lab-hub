// Each lab sets its own name with the LAB_NAME environment variable (see README).
export const LAB_NAME = import.meta.env.LAB_NAME || "Lab Hub";
export const LAB_SLUG = LAB_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lab-hub";
