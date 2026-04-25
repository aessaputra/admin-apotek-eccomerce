import { useCallback, useMemo } from "react";
import type { FocusEvent } from "react";
import type { FormInstance, Rule } from "antd/es/form";
import { message } from "antd";
import { supabaseClient } from "../providers/supabase-client";
import { isDuplicateSkuError, isValidSku, normalizeSku } from "../utils/sku";

type Translate = (key: string, fallback?: string) => string;

interface UseProductSkuFieldParams {
  form: FormInstance;
  translate: Translate;
  currentProductId?: string;
}

function normalizeSkuInput(value: unknown): string {
  return normalizeSku(typeof value === "string" ? value : "");
}

export function useProductSkuField({
  form,
  translate,
  currentProductId,
}: UseProductSkuFieldParams) {
  const requiredMessage = translate(
    "products.validation.skuRequired",
    "SKU is required"
  );
  const invalidMessage = translate(
    "products.validation.skuInvalid",
    "SKU must be 4-50 characters using uppercase letters, numbers, and hyphens."
  );
  const duplicateMessage = translate(
    "products.validation.skuDuplicate",
    "This SKU is already used by another product."
  );

  const setSkuError = useCallback((errorMessage: string) => {
    form.setFields([{ name: "sku", errors: [errorMessage] }]);
  }, [form]);

  const handleSkuBlur = useCallback((event: FocusEvent<HTMLInputElement>) => {
    form.setFieldValue("sku", normalizeSku(event.target.value));
  }, [form]);

  const skuRules = useMemo<Rule[]>(() => [
    { required: true, message: requiredMessage },
    {
      validator: async (_, value) => {
        if (isValidSku(normalizeSkuInput(value))) return;
        throw new Error(invalidMessage);
      },
    },
  ], [invalidMessage, requiredMessage]);

  const normalizeAndValidateSku = useCallback(async (rawValue: unknown) => {
    const sku = normalizeSkuInput(rawValue);

    if (!isValidSku(sku)) {
      setSkuError(invalidMessage);
      throw new Error(invalidMessage);
    }

    const duplicateQuery = supabaseClient
      .from("admin_products")
      .select("id")
      .eq("sku", sku);
    const scopedQuery = currentProductId
      ? duplicateQuery.neq("id", currentProductId)
      : duplicateQuery;
    const { data, error } = await scopedQuery.limit(1);

    if (error) throw error;

    if (Array.isArray(data) && data.length > 0) {
      setSkuError(duplicateMessage);
      throw new Error(duplicateMessage);
    }

    return sku;
  }, [currentProductId, duplicateMessage, invalidMessage, setSkuError]);

  const handleDuplicateSkuSubmitError = useCallback((error: unknown) => {
    if (!isDuplicateSkuError(error)) return false;

    setSkuError(duplicateMessage);
    message.error(duplicateMessage);
    return true;
  }, [duplicateMessage, setSkuError]);

  return {
    handleDuplicateSkuSubmitError,
    handleSkuBlur,
    normalizeAndValidateSku,
    setSkuError,
    skuRules,
  };
}
