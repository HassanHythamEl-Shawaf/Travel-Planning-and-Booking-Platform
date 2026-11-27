import type { Metadata } from "next";
import Link from "next/link";

import { AccountProfileForm } from "@/components/account/account-profile-form";
import { serverApiRequest } from "@/lib/api/server";

export const metadata: Metadata = { title: "Account profile" };

interface AccountProfile {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin" | "moderator";
  phone?: string;
  preferredCurrency?: string;
}

interface Currency {
  id: string;
  countryCodes: string[];
}

interface Paginated<T> {
  items: T[];
  totalPages: number;
}

async function getCurrencies(): Promise<Currency[]> {
  const firstPage = await serverApiRequest<Paginated<Currency>>("/currencies?page=1");
  if (firstPage.totalPages <= 1) return firstPage.items;

  const remainingPages = await Promise.all(
    Array.from({ length: firstPage.totalPages - 1 }, (_, index) =>
      serverApiRequest<Paginated<Currency>>(`/currencies?page=${index + 2}`),
    ),
  );
  return [...firstPage.items, ...remainingPages.flatMap((page) => page.items)];
}

export default async function AccountProfilePage() {
  const [profile, currencies] = await Promise.all([
    serverApiRequest<AccountProfile>("/users/me"),
    getCurrencies(),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow-small">Account settings</p>
          <h1>Your profile</h1>
          <p>Keep your contact details and travel preferences up to date.</p>
        </div>
        <Link className="button button-secondary" href="/account/change-password">
          Change password
        </Link>
      </div>
      <AccountProfileForm profile={profile} currencies={currencies} />
    </>
  );
}
