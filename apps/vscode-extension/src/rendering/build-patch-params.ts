import type { CachedAllocation } from "@runtimeads/sdk-contracts";

import { resolveCampaignIconDataUrl } from "../signals/campaign-icon-cache";

export interface WebviewPatchParams {
  brand: string;
  headline: string;
  iconUrl: string;
  clickUrl: string;
  allocationId: string;
  loopbackBase: string;
}

export async function buildWebviewPatchParams(
  allocation: CachedAllocation | undefined,
  loopbackBase: string,
): Promise<WebviewPatchParams> {
  if (!allocation) {
    return {
      brand: "",
      headline: "",
      iconUrl: "",
      clickUrl: "",
      allocationId: "bootstrap",
      loopbackBase,
    };
  }

  const iconUrl = allocation.iconUrl
    ? ((await resolveCampaignIconDataUrl(allocation.iconUrl)) ?? "")
    : "";

  return {
    brand: allocation.brand,
    headline: allocation.headline,
    iconUrl,
    clickUrl: allocation.destinationUrl,
    allocationId: allocation.allocationId,
    loopbackBase,
  };
}
