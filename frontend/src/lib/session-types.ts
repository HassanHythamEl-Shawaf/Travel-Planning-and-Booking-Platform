export type UserRole = "user" | "admin" | "moderator";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "active" | "suspended" | "deactivated";
  phone?: string;
  preferredCurrency?: string;
  mustChangePassword: boolean;
  createdAt?: string;
}

export function roleHome(role: UserRole): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "moderator":
      return "/moderator";
    case "user":
      return "/dashboard";
  }
}
