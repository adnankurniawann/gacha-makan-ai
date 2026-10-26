"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { AppHeader } from "@/components/home/app-header";
import { BottomNav } from "@/components/home/bottom-nav";
import { Card, MenuList, MenuRow, SectionHeader } from "@/components/ui/surface";
import { History, LogOut, MapPin, RefreshCw, Sparkles, Wallet } from "lucide-react";

function getDisplayName(session: Session | null): string {
  if (!session) return "Tamu";
  const user = session.user;
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName = metadata?.full_name;
  const name = metadata?.name;

  if (typeof fullName === "string" && fullName.trim().length > 0)
    return fullName;
  if (typeof name === "string" && name.trim().length > 0) return name;
  return user.email?.split("@")[0] ?? "Pengguna";
}

function getUserMetadata(session: Session | null): Record<string, unknown> {
  return session?.user.user_metadata as Record<string, unknown> | undefined ?? {};
}

function getAvatarUrl(session: Session | null, displayName: string): string {
  const metadata = getUserMetadata(session);
  const avatarUrl = metadata.avatar_url;
  if (typeof avatarUrl === "string" && avatarUrl.trim().length > 0) {
    return avatarUrl;
  }

  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(displayName)}`;
}

function getBio(session: Session | null): string {
  const metadata = getUserMetadata(session);
  const bio = metadata.bio;
  return typeof bio === "string" ? bio : "";
}

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    fullName: "",
    bio: "",
    avatarUrl: "",
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [savedAvatarUrl, setSavedAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const hasCheckedSession = useRef(false);

  const clearAvatarSelection = () => {
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = "";
    }
  };

  useEffect(() => {
    if (!session) {
      setProfileForm({ fullName: "", bio: "", avatarUrl: "" });
      clearAvatarSelection();
      setSavedAvatarUrl(null);
      return;
    }

    const metadata = getUserMetadata(session);
    setProfileForm({
      fullName: String(metadata.full_name ?? metadata.name ?? ""),
      bio: String(metadata.bio ?? ""),
      avatarUrl: String(metadata.avatar_url ?? ""),
    });
    clearAvatarSelection();
    setSavedAvatarUrl(String(metadata.avatar_url ?? "") || null);
  }, [session]);

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [avatarFile]);

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;
      setSession(data.session ?? null);
      setIsLoading(false);
      hasCheckedSession.current = true;
    };

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await supabase.auth.signOut();
    setIsSigningOut(false);
    router.replace("/");
  };

  const handleRefreshSession = async () => {
    const { data } = await supabase.auth.getSession();
    setSession(data.session ?? null);
    setIsLoading(false);
    clearAvatarSelection();
  };

  const handleAvatarFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setAvatarFile(file);
    if (file) {
      setProfileForm((current) => ({
        ...current,
        avatarUrl: "",
      }));
    }
  };

  const uploadAvatarToStorage = async (file: File): Promise<string> => {
    if (!session) {
      throw new Error("Masuk dulu untuk mengunggah foto profil.");
    }

    const fileExt = file.name.split(".").pop() ?? "png";
    const filePath = `${session.user.id}/${Date.now()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || "image/png",
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(filePath);
    return data.publicUrl;
  };

  const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!session) {
      setProfileMessage("Masuk dulu untuk menyimpan profil.");
      return;
    }

    setIsSavingProfile(true);
    setProfileMessage(null);
    setIsUploadingAvatar(Boolean(avatarFile));

    const fullName = profileForm.fullName.trim();
    const bio = profileForm.bio.trim();
    let avatarUrl = profileForm.avatarUrl.trim();

    try {
      if (avatarFile) {
        avatarUrl = await uploadAvatarToStorage(avatarFile);
      }

      const nextMetadata = {
        ...getUserMetadata(session),
        full_name: fullName,
        name: fullName,
        bio,
        avatar_url: avatarUrl,
      };

      const { data, error } = await supabase.auth.updateUser({
        data: nextMetadata,
      });

      if (error) {
        setProfileMessage(error.message ?? "Gagal menyimpan profil.");
        return;
      }

      const nextSession = data.user ? { ...session, user: data.user } : session;
      setSession(nextSession);
      setSavedAvatarUrl(avatarUrl || null);
      clearAvatarSelection();
      await handleRefreshSession();
      
      router.refresh();
      
      setProfileMessage(
        avatarFile
          ? "Profil dan foto berhasil disimpan."
          : "Profil berhasil disimpan.",
      );
    } catch (error) {
      setProfileMessage(
        error instanceof Error ? error.message : "Gagal menyimpan profil.",
      );
    } finally {
      setIsSavingProfile(false);
      setIsUploadingAvatar(false);
    }
  };

  const displayName = getDisplayName(session);
  const email = session?.user.email ?? "Tamu belum login";
  const createdAt = formatDate(session?.user.created_at);
  const lastSignIn = formatDate(session?.user.last_sign_in_at ?? undefined);
  const bio = getBio(session);
  const avatarUrl = getAvatarUrl(session, displayName);
  const liveDisplayName =
    profileForm.fullName.trim().length > 0 ? profileForm.fullName.trim() : displayName;
  const liveBio = profileForm.bio.trim().length > 0 ? profileForm.bio.trim() : bio;
  const liveAvatarUrl =
    avatarPreviewUrl ??
    savedAvatarUrl ??
    (profileForm.avatarUrl.trim().length > 0 ? profileForm.avatarUrl.trim() : avatarUrl);

  const initials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "GM";

  const isAnonymous = session?.user?.is_anonymous === true;

  return (
    <main className="min-h-screen bg-slate-100 pb-24 font-sans text-slate-800 md:pb-10">
      <AppHeader session={false} />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 pt-3 md:px-6">
        {isLoading ? (
          <div className="flex animate-pulse flex-col gap-3">
            <div className="h-28 rounded-xl bg-slate-200" />
            <div className="h-40 rounded-xl bg-slate-200" />
          </div>
        ) : (
          <>
            {/* Kartu profil. Rata, tanpa lingkaran blur dekoratif dan tanpa
                nama sebesar judul halaman. */}
            <Card className="flex items-center gap-3.5">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rose-500 text-base font-semibold text-white">
                {isAnonymous ? (
                  initials
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={liveAvatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold tracking-tight text-slate-900">
                  {isAnonymous ? "Kamu belum punya akun" : liveDisplayName}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {isAnonymous
                    ? "Sesi tamu — riwayat tersimpan di HP ini saja"
                    : email}
                </p>
                {liveBio && !isAnonymous ? (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                    {liveBio}
                  </p>
                ) : null}
              </div>

              {isAnonymous && (
                <Link
                  href="/login"
                  className="shrink-0 rounded-lg bg-rose-500 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-rose-600"
                >
                  Masuk
                </Link>
              )}
            </Card>

            {/* Ajakan menyimpan akun hanya untuk yang memang punya sesuatu
                untuk hilang. */}
            {isAnonymous && (
              <Card className="border-amber-200 bg-amber-50">
                <p className="text-sm font-semibold text-amber-900">
                  Simpan email, sekali saja
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800">
                  Riwayat spin dan daftar simpananmu ikut terbawa, bahkan kalau
                  kamu ganti HP. Tidak ada password yang perlu diingat.
                </p>
              </Card>
            )}

            {!isAnonymous && session ? (
              <div className="grid grid-cols-2 gap-3">
                <Card>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Bergabung
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {createdAt}
                  </p>
                </Card>
                <Card>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Terakhir masuk
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {lastSignIn}
                  </p>
                </Card>
              </div>
            ) : null}

            <div>
              <SectionHeader title="Punyamu" />
              <MenuList>
                <MenuRow
                  href="/riwayat"
                  icon={History}
                  label="Riwayat & simpanan"
                  hint="Spin terakhir dan tempat yang kamu simpan"
                />
                <MenuRow
                  href="/dompet"
                  icon={Wallet}
                  label="Dompet makan"
                  hint="Atur jatah bulanan dan pantau sisanya"
                />
                <MenuRow
                  href="/spin"
                  icon={Sparkles}
                  label="Spin dengan filter"
                  hint="Atur budget, jarak, dan jam buka"
                />
                <MenuRow
                  href="/map"
                  icon={MapPin}
                  label="Peta restoran"
                  hint="Lihat sebaran dan status kebersihan"
                />
              </MenuList>
            </div>

            {!isAnonymous && (
              <div>
                <SectionHeader title="Profil" />
                <Card>
                  <form
                    onSubmit={(e) => void handleSaveProfile(e)}
                    className="grid gap-3"
                  >
                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold text-slate-600">
                        Nama tampil
                      </span>
                      <input
                        value={profileForm.fullName}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            fullName: event.target.value,
                          }))
                        }
                        placeholder="Nama yang muncul di aplikasi"
                        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                      />
                    </label>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold text-slate-600">
                        Bio singkat
                      </span>
                      <textarea
                        value={profileForm.bio}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            bio: event.target.value,
                          }))
                        }
                        rows={3}
                        placeholder="Mahasiswa lapar yang suka cari makan murah."
                        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                      />
                    </label>

                    <label className="grid gap-1.5">
                      <span className="text-xs font-semibold text-slate-600">
                        Foto profil
                      </span>
                      <input
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleAvatarFileChange}
                        className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-rose-500 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white"
                      />
                      {/* Kolom URL dipertahankan untuk yang sudah terlanjur
                          memakainya, tapi tidak lagi sejajar dengan unggahan:
                          dua cara mengisi hal yang sama, berdampingan, membuat
                          orang ragu mana yang menang. */}
                      <input
                        value={profileForm.avatarUrl}
                        onChange={(event) =>
                          setProfileForm((current) => ({
                            ...current,
                            avatarUrl: event.target.value,
                          }))
                        }
                        placeholder="atau tempel URL foto"
                        className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs text-slate-700 outline-none transition focus:border-rose-400"
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={isSavingProfile}
                      className="mt-1 rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingProfile
                        ? isUploadingAvatar
                          ? "Mengunggah foto…"
                          : "Menyimpan…"
                        : "Simpan profil"}
                    </button>

                    {profileMessage ? (
                      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
                        {profileMessage}
                      </p>
                    ) : null}
                  </form>
                </Card>
              </div>
            )}

            <div>
              <SectionHeader title="Lainnya" />
              <MenuList>
                <MenuRow
                  onClick={() => void handleRefreshSession()}
                  icon={RefreshCw}
                  label="Muat ulang data akun"
                  hint="Kalau perubahanmu belum kelihatan"
                />
                {session && !isAnonymous ? (
                  <MenuRow
                    onClick={() => void handleSignOut()}
                    icon={LogOut}
                    label={isSigningOut ? "Keluar…" : "Keluar akun"}
                    danger
                  />
                ) : null}
              </MenuList>
            </div>
          </>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
