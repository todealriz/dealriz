import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

// Block crawlers from admin tooling and the job trigger endpoint.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/api/admin", "/api/jobs"],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
