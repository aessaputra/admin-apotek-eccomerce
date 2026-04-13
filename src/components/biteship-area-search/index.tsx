import { useState, useCallback, useRef, useEffect } from "react";
import { AutoComplete, Spin, Typography, Tag } from "antd";
import { useTranslation } from "@refinedev/core";
import { supabaseClient } from "../../providers/supabase-client";

export interface BiteshipArea {
  id: string;
  name: string;
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
  onAreaSelect?: (area: {
    areaId: string;
    areaName: string;
    postalCode: number;
  }) => void;
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
  const [selectedArea, setSelectedArea] = useState<BiteshipArea | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync with external value (form field)
  useEffect(() => {
    if (value && selectedArea && value !== selectedArea.id) {
      // External value changed, reset selected area
      setSelectedArea(null);
    }
  }, [value, selectedArea]);

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
        value: area.id,
        label: (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "2px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Typography.Text strong>{area.name}</Typography.Text>
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
      setIsDropdownOpen(true);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (text: string) => {
    setSearchText(text);
    // Clear selected area when user starts typing new search
    if (selectedArea) {
      setSelectedArea(null);
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      searchAreas(text);
    }, 500);
  };

  const handleSelect = (_value: string, option: { area: BiteshipArea }) => {
    const area = option.area;
    if (area) {
      setSelectedArea(area);
      setSearchText("");
      setOptions([]);
      setIsDropdownOpen(false);
      
      // Call onChange with area_id for form field binding
      if (onChange) {
        onChange(area.id);
      }
      
      // Call onAreaSelect with full area data
      if (onAreaSelect) {
        onAreaSelect({
          areaId: area.id,
          areaName: area.name,
          postalCode: area.postal_code,
        });
      }
    }
  };

  const handleBlur = () => {
    // Delay clearing dropdown to allow selection to complete
    setTimeout(() => {
      setIsDropdownOpen(false);
    }, 200);
  };

  const handleFocus = () => {
    if (options.length > 0) {
      setIsDropdownOpen(true);
    }
  };

  // Display selected area name, or search text, or empty
  const displayValue = selectedArea 
    ? `${selectedArea.name} (${selectedArea.postal_code})`
    : searchText;

  return (
    <AutoComplete
      value={displayValue}
      options={isDropdownOpen ? options : []}
      onSearch={handleSearch}
      onSelect={handleSelect}
      onBlur={handleBlur}
      onFocus={handleFocus}
      placeholder={placeholder}
      notFoundContent={
        loading ? (
          <Spin size="small" />
        ) : (
          translate("settings.noAreasFound", {}, "No areas found")
        )
      }
      filterOption={false}
      style={{ width: "100%" }}
    />
  );
};

export default BiteshipAreaSearch;
