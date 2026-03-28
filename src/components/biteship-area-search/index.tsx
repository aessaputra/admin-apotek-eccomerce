import { useState, useCallback, useRef } from "react";
import { AutoComplete, Spin, Typography, Tag } from "antd";
import { useTranslation } from "@refinedev/core";
import { supabaseClient } from "../../providers/supabase-client";

export interface BiteshipArea {
  area_id: string;
  area_name: string;
  postal_code: number;
  country_name: string;
  country_code: string;
  administrative_division_level_1_name?: string;
  administrative_division_level_2_name?: string;
  administrative_division_level_3_name?: string;
  administrative_division_level_4_name?: string;
}

export interface BiteshipAreaSearchProps {
  value?: string;
  onChange?: (areaId: string) => void;
  onAreaSelect?: (area: BiteshipArea) => void;
  placeholder?: string;
}

export const BiteshipAreaSearch: React.FC<BiteshipAreaSearchProps> = ({
  value,
  onChange,
  onAreaSelect,
  placeholder,
}) => {
  const { translate } = useTranslation();
  const [options, setOptions] = useState<
    { value: string; label: React.ReactNode; area: BiteshipArea }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchAreas = useCallback(async (query: string) => {
    if (!query || query.length < 3) {
      setOptions([]);
      return;
    }

    setLoading(true);
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        setOptions([]);
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/biteship`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: "maps",
            payload: { input: query },
          }),
        }
      );

      if (!response.ok) {
        setOptions([]);
        return;
      }

      const data = await response.json();
      const areas: BiteshipArea[] = data.areas || [];

      const areaOptions = areas.map((area) => ({
        value: area.area_id,
        label: (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "2px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Typography.Text strong>{area.area_name}</Typography.Text>
              <Tag style={{ fontSize: "11px", padding: "0 4px" }}>
                {area.postal_code}
              </Tag>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: "12px" }}>
              {[
                area.administrative_division_level_1_name,
                area.administrative_division_level_2_name,
              ]
                .filter(Boolean)
                .join(", ")}
            </Typography.Text>
          </div>
        ),
        area,
      }));

      setOptions(areaOptions);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (text: string) => {
    setIsSearching(true);
    setSearchText(text);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      searchAreas(text);
    }, 500);
  };

  const handleSelect = (selectedValue: string) => {
    const selected = options.find((opt) => opt.value === selectedValue);
    if (selected) {
      const label = `${selected.area.area_name} (${selected.area.postal_code})`;
      setSelectedLabel(label);
      setIsSearching(false);
      if (onAreaSelect) {
        onAreaSelect(selected.area);
      }
    }
    if (onChange) {
      onChange(selectedValue);
    }
    setSearchText("");
    setOptions([]);
  };

  const handleBlur = () => {
    setIsSearching(false);
    setSearchText("");
    setOptions([]);
  };

  const displayValue = isSearching
    ? searchText
    : selectedLabel || value || searchText;

  return (
    <AutoComplete
      value={displayValue}
      options={options}
      onSearch={handleSearch}
      onSelect={handleSelect}
      onBlur={handleBlur}
      placeholder={placeholder}
      notFoundContent={
        loading ? (
          <Spin size="small" />
        ) : (
          translate("settings.noAreasFound", "No areas found")
        )
      }
      filterOption={false}
      style={{ width: "100%" }}
    />
  );
};

export default BiteshipAreaSearch;
