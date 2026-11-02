import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createPage, exchangeLinkCode, finishLogin, pageIdForSlug } from "@/lib/data";
import { ActionError } from "@/lib/errors";
import { requestOrigin } from "@/lib/origin";
import { isSlug } from "@/lib/slug";
import { START_COOKIE, readStart } from "@/lib/startToken";

// Where the emailed sign-in link lands. Two kinds of link come here:
//   ?slug=...        a follower signing in to a page
//   ?flow=create     an owner who asked to start a page
// Either way the code in the URL is traded for a session first.
export async function GET(request: NextRequest) {
  const origin = await requestOrigin();
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const slug = params.get("slug") ?? "";
  const creating = params.get("flow") === "create";

  const back = (error?: string) => {
    const path = creating ? "/" : isSlug(slug) ? `/p/${slug}` : "/";
    const url = new URL(path, origin);
    if (error) url.searchParams.set("error", error);
    const response = NextResponse.redirect(url);
    if (creating) response.cookies.delete(START_COOKIE);
    return response;
  };

  if (!code) return back("That link didn't work. Ask for a new one.");

  try {
    const { userId, email } = await exchangeLinkCode(code);

    if (creating) {
      const start = readStart((await cookies()).get(START_COOKIE)?.value);
      if (!start || start.email !== email) {
        throw new ActionError("Start again from the home page. That link was opened somewhere else.");
      }
      const created = await createPage({ patientFirstName: start.patient, ownerName: start.name });
      const response = NextResponse.redirect(new URL(`/p/${created.slug}`, origin));
      response.cookies.delete(START_COOKIE);
      return response;
    }

    if (!isSlug(slug)) return NextResponse.redirect(new URL("/", origin));
    const pageId = await pageIdForSlug(slug);
    if (!pageId) throw new ActionError("This page doesn't exist.");
    await finishLogin(pageId, userId);
    return NextResponse.redirect(new URL(`/p/${slug}`, origin));
  } catch (error) {
    if (error instanceof ActionError) return back(error.message);
    throw error;
  }
}
