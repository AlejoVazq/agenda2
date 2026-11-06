import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/panel", "/api", "/t/", "/auth", "/onboarding", "/cuenta"] },
  };
}
