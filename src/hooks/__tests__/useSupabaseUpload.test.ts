import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSupabaseUpload } from "../useSupabaseUpload";

const mocks = vi.hoisted(() => {
  const messageError = vi.fn();
  const getUser = vi.fn();
  const remove = vi.fn();
  const upload = vi.fn();
  const getPublicUrl = vi.fn();
  const from = vi.fn(() => ({
    remove,
    upload,
    getPublicUrl,
  }));

  return {
    messageError,
    getUser,
    remove,
    upload,
    getPublicUrl,
    from,
  };
});

vi.mock("antd", () => ({
  message: {
    error: mocks.messageError,
  },
}));

vi.mock("../..//providers/supabase-client", () => ({
  supabaseClient: {
    auth: {
      getUser: mocks.getUser,
    },
    storage: {
      from: mocks.from,
    },
  },
}));

describe("useSupabaseUpload", () => {
  beforeEach(() => {
    mocks.messageError.mockReset();
    mocks.getUser.mockReset();
    mocks.remove.mockReset();
    mocks.upload.mockReset();
    mocks.getPublicUrl.mockReset();
    mocks.from.mockClear();

    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    mocks.remove.mockResolvedValue({ data: [] });
    mocks.upload.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: "https://demo.supabase.co/storage/v1/object/public/media/uploads/file.png" },
    });
  });

  it("rejects invalid files before upload and shows an error message", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useSupabaseUpload(
        { bucket: "media", pathPrefix: "uploads/" },
        undefined,
        onChange
      )
    );

    const invalidFile = new File(["bad"], "notes.txt", { type: "text/plain" });
    const uploadAllowed = result.current.beforeUpload(invalidFile as never);

    expect(uploadAllowed).toBe(false);
    expect(mocks.messageError).toHaveBeenCalledWith("Format file harus JPG, PNG, WebP, atau GIF");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("replaces the previous single file upload and updates the field value", async () => {
    const onChange = vi.fn();
    vi.spyOn(Date, "now").mockReturnValue(1711987200000);

    const { result } = renderHook(() =>
      useSupabaseUpload(
        {
          bucket: "media",
          pathPrefix: "avatars/",
          replaceOnUpload: true,
          includeUserId: true,
        },
        "https://demo.supabase.co/storage/v1/object/public/media/avatars/old-avatar.png",
        onChange
      )
    );

    const onSuccess = vi.fn();
    const onError = vi.fn();
    const nextFile = new File(["image"], "new avatar.png", { type: "image/png" });

    result.current.customRequest({ file: nextFile, onSuccess, onError });

    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith(["avatars/old-avatar.png"]);
      expect(mocks.upload).toHaveBeenCalledWith(
        "avatars/user-1-1711987200000-new_avatar.png",
        nextFile,
        { upsert: true, cacheControl: "3600" }
      );
      expect(onChange).toHaveBeenCalledWith(
        "https://demo.supabase.co/storage/v1/object/public/media/uploads/file.png"
      );
      expect(onSuccess).toHaveBeenCalledWith({
        url: "https://demo.supabase.co/storage/v1/object/public/media/uploads/file.png",
      });
      expect(onError).not.toHaveBeenCalled();
    });

    vi.mocked(Date.now).mockRestore();
  });

  it("appends uploaded files when the field value is an array", async () => {
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useSupabaseUpload(
        { bucket: "media", pathPrefix: "products/" },
        ["https://demo.supabase.co/storage/v1/object/public/media/products/existing.png"],
        onChange
      )
    );

    result.current.customRequest({
      file: new File(["image"], "gallery.png", { type: "image/png" }),
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([
        "https://demo.supabase.co/storage/v1/object/public/media/products/existing.png",
        "https://demo.supabase.co/storage/v1/object/public/media/uploads/file.png",
      ]);
    });
  });

  it("removes stored files and clears array values on delete", async () => {
    const onChange = vi.fn();

    const { result } = renderHook(() =>
      useSupabaseUpload(
        { bucket: "media", pathPrefix: "products/" },
        [
          "https://demo.supabase.co/storage/v1/object/public/media/products/keep.png",
          "https://demo.supabase.co/storage/v1/object/public/media/products/remove.png",
        ],
        onChange
      )
    );

    result.current.handleRemove(
      "https://demo.supabase.co/storage/v1/object/public/media/products/remove.png"
    );

    await waitFor(() => {
      expect(mocks.remove).toHaveBeenCalledWith(["products/remove.png"]);
      expect(onChange).toHaveBeenCalledWith([
        "https://demo.supabase.co/storage/v1/object/public/media/products/keep.png",
      ]);
    });
  });
});
