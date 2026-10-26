// The member screens' chunks (board #511, S-3), in one place so the routes load them and the frame can load the tabs'
// ahead (board #530, O2) without importing the routes.
export const memberScreens = {
  home: () => import("../features/member/HomeScreen"),
  book: () => import("../features/member/BookScreen"),
  bookings: () => import("../features/member/BookingsScreen"),
  inbox: () => import("../features/member/InboxScreen"),
  profile: () => import("../features/member/ProfileScreen"),
};
