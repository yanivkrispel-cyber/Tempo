import { lazyNamed } from "../../app/lazyScreen";

/** The studio's public page, loaded only when a visitor or a studio path shows it (board #511, S-3). */
export const PublicStudioPage = lazyNamed(() => import("./PublicStudioPage"), "PublicStudioPage");
