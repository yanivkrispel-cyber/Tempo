import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpenInBrowserCard } from "./OpenInBrowserCard";

const url = "https://tempo-members.pages.dev/s/studio-breath/c/7f3a";
const instagramAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 390.0.0.43.81 Android";
const instagramIos =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.27.80";
const safariIos =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

describe("OpenInBrowserCard (SL-7, board ו)", () => {
  it("links Android to Chrome, saying the place is kept", () => {
    render(<OpenInBrowserCard url={url} agent={instagramAndroid} />);
    expect(screen.getByText(/המקום שמור/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "פתיחה בדפדפן" });
    expect(link.getAttribute("href")).toMatch(
      /^intent:\/\/tempo-members\.pages\.dev\/s\/studio-breath\/c\/7f3a#Intent;scheme=https;package=com\.android\.chrome;/,
    );
  });

  it("tells an iPhone where the browser button is, with no link", () => {
    render(<OpenInBrowserCard url={url} agent={instagramIos} />);
    expect(screen.getByText(/פתיחה בדפדפן/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows nothing in a real browser", () => {
    const { container } = render(<OpenInBrowserCard url={url} agent={safariIos} />);
    expect(container).toBeEmptyDOMElement();
  });
});
