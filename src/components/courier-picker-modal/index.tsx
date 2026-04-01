import { useState, useEffect } from "react";
import { Modal, Switch, Typography, Space, Tag, Empty, Spin, Card, Collapse, Input, theme } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useTranslation } from "@refinedev/core";
import type { CourierServiceOption } from "../../constants/couriers";
import {
  getCourierSelectionCompany,
  getFallbackCourierOption,
  normalizeCourierSelection,
} from "../../constants/couriers";

const { Text, Title } = Typography;
const { useToken } = theme;

export function expandLegacySelections(
  selections: string[],
  availableServices: CourierServiceOption[],
): Set<string> {
  const expandedSelections = new Set<string>();

  for (const selection of selections) {
    const normalizedSelection = normalizeCourierSelection(selection);
    if (!normalizedSelection) {
      continue;
    }

    const companyCode = getCourierSelectionCompany(normalizedSelection);
    if (!companyCode) {
      continue;
    }

    if (normalizedSelection.includes(":")) {
      expandedSelections.add(normalizedSelection);
      continue;
    }

    expandedSelections.add(`${companyCode}:*`);

    for (const courier of availableServices) {
      if (courier.companyCode === companyCode) {
        expandedSelections.add(courier.key);
      }
    }
  }

  return expandedSelections;
}

export function toggleCourierServiceSelection(
  currentSelection: Set<string>,
  serviceKey: string,
): Set<string> {
  const next = new Set(currentSelection);
  const companyCode = getCourierSelectionCompany(serviceKey);

  if (!companyCode) {
    return next;
  }

  const wildcardSelectionKey = `${companyCode}:*`;
  const isWildcardSelection = serviceKey === wildcardSelectionKey;

  if (!isWildcardSelection) {
    next.delete(wildcardSelectionKey);
  }

  if (next.has(serviceKey)) {
    next.delete(serviceKey);
  } else {
    next.add(serviceKey);
  }

  return next;
}

interface CourierPickerModalProps {
  open: boolean;
  value: string[];
  couriers: CourierServiceOption[];
  loading?: boolean;
  error?: string | null;
  readOnly?: boolean;
  onConfirm: (selectedCouriers: string[]) => void;
  onCancel: () => void;
}

export const CourierPickerModal: React.FC<CourierPickerModalProps> = ({
  open,
  value,
  couriers,
  loading = false,
  error,
  readOnly = false,
  onConfirm,
  onCancel,
}) => {
  const { translate } = useTranslation();
  const { token } = useToken();

  const createSelectionPlaceholder = (selection: string): CourierServiceOption | null => {
    const normalizedSelection = normalizeCourierSelection(selection);
    if (!normalizedSelection) {
      return null;
    }

    const companyCode = getCourierSelectionCompany(normalizedSelection);
    if (!companyCode) {
      return null;
    }

    const fallbackCourier = getFallbackCourierOption(companyCode);
    const [_, ...serviceParts] = normalizedSelection.split(":");
    const serviceCode = serviceParts.join(":") || "*";

    return {
      key: serviceCode === "*" ? `${companyCode}:*` : normalizedSelection,
      companyCode,
      companyLabel: fallbackCourier.label,
      serviceCode,
      serviceLabel:
        serviceCode === "*"
          ? translate("settings.courierPicker.allServices", {}, "All services")
          : serviceCode.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      description:
        serviceCode === "*"
          ? fallbackCourier.description
          : translate(
              "settings.courierPicker.savedServiceSelection",
              { service: serviceCode },
              `Saved service selection (${serviceCode})`
            ),
    };
  };

  const [localSelection, setLocalSelection] = useState<Set<string>>(expandLegacySelections(value, couriers));
  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    if (open) {
      setLocalSelection(expandLegacySelections(value, couriers));
      setSearchValue("");
    }
  }, [couriers, open, value]);

  const handleServiceToggle = (serviceKey: string) => {
    setLocalSelection((prev) => {
      return toggleCourierServiceSelection(prev, serviceKey);
    });
  };

  const handleSelectAll = () => {
    setLocalSelection(new Set(couriers.map((courier) => courier.key)));
  };

  const handleClearAll = () => {
    setLocalSelection(new Set());
  };

  const mergedCouriers = Array.from(
    new Map(
      [
        ...couriers,
        ...value
          .map((selection) => {
            const normalizedSelection = normalizeCourierSelection(selection);
            if (!normalizedSelection) {
              return null;
            }

            const companyCode = getCourierSelectionCompany(normalizedSelection);
            if (!companyCode) {
              return null;
            }

            const availableCompanyServices = couriers.filter(
              (courier) => courier.companyCode === companyCode,
            );

            if (!normalizedSelection.includes(":")) {
              return availableCompanyServices.length === 0
                ? createSelectionPlaceholder(normalizedSelection)
                : null;
            }

            const hasExactService = availableCompanyServices.some(
              (courier) => courier.key === normalizedSelection,
            );

            return hasExactService ? null : createSelectionPlaceholder(normalizedSelection);
          })
          .filter((selection): selection is CourierServiceOption => selection !== null),
      ].map((courier) => [courier.key, courier]),
    ).values(),
  );
  const groupedCouriers = Array.from(
    mergedCouriers.reduce((map, courier) => {
      const existingGroup = map.get(courier.companyCode);
      if (existingGroup) {
        existingGroup.services.push(courier);
      } else {
        map.set(courier.companyCode, {
          companyCode: courier.companyCode,
          companyLabel: courier.companyLabel,
          services: [courier],
        });
      }

      return map;
    }, new Map<string, { companyCode: string; companyLabel: string; services: CourierServiceOption[] }>()).values()
  );

  const normalizedSearchValue = searchValue.trim().toLowerCase();
  const filteredGroupedCouriers = groupedCouriers
    .map((group) => {
      if (!normalizedSearchValue) {
        return group;
      }

      const filteredServices = group.services.filter((service) => {
        const companyLabel = group.companyLabel.toLowerCase();
        const serviceLabel = service.serviceLabel.toLowerCase();
        const description = service.description.toLowerCase();
        const companyCode = service.companyCode.toLowerCase();
        const serviceCode = service.serviceCode.toLowerCase();

        return (
          companyLabel.includes(normalizedSearchValue) ||
          serviceLabel.includes(normalizedSearchValue) ||
          description.includes(normalizedSearchValue) ||
          companyCode.includes(normalizedSearchValue) ||
          serviceCode.includes(normalizedSearchValue)
        );
      });

      return {
        ...group,
        services: filteredServices,
      };
    })
    .filter((group) => group.services.length > 0);

  const getDisplayedServices = (group: {
    companyCode: string;
    companyLabel: string;
    services: CourierServiceOption[];
  }): CourierServiceOption[] => {
    const actualServices = group.services.filter((service) => service.serviceCode !== '*');
    return actualServices.length > 0 ? actualServices : group.services;
  };

  const getNormalizedSelections = (selectionSet: Set<string>): string[] => {
    const normalizedSelections: string[] = [];

    for (const group of groupedCouriers) {
      const wildcardSelectionKey = `${group.companyCode}:*`;
      const displayedServices = getDisplayedServices(group);
      const hasWildcardSelection = selectionSet.has(wildcardSelectionKey);
      const selectedDisplayedServices = displayedServices.filter((service) => selectionSet.has(service.key));

      if (displayedServices.length === 0) {
        continue;
      }

      if (hasWildcardSelection) {
        normalizedSelections.push(group.companyCode);
        continue;
      }

      normalizedSelections.push(...selectedDisplayedServices.map((service) => service.key));
    }

    return normalizedSelections;
  };

  const handleOk = () => {
    onConfirm(getNormalizedSelections(localSelection));
  };

  const selectedCount = groupedCouriers.reduce((count, group) => {
    const wildcardSelectionKey = `${group.companyCode}:*`;
    const displayedServices = getDisplayedServices(group);
    if (localSelection.has(wildcardSelectionKey)) {
      return count + displayedServices.length;
    }

    return count + displayedServices.filter((service) => localSelection.has(service.key)).length;
  }, 0);
  const totalCount = groupedCouriers.reduce((count, group) => count + getDisplayedServices(group).length, 0);

  const renderCourierCard = (group: { companyCode: string; companyLabel: string; services: CourierServiceOption[] }) => {
    const wildcardSelectionKey = `${group.companyCode}:*`;
    const hasWildcardSelection = localSelection.has(wildcardSelectionKey);
    const displayedServices = getDisplayedServices(group);
    const selectedServicesCount = displayedServices.filter(
      (service) => hasWildcardSelection || localSelection.has(service.key),
    ).length;
    const allServicesSelected = selectedServicesCount === displayedServices.length && displayedServices.length > 0;
    return (
      <Card
        key={group.companyCode}
        size="small"
        styles={{ body: { padding: "0" } }}
        style={{
          borderRadius: 12,
          borderColor: selectedServicesCount > 0 ? token.colorPrimaryBorder : token.colorBorderSecondary,
          backgroundColor: token.colorBgElevated,
          boxShadow: "none",
        }}
      >
        <Collapse
          bordered={false}
          ghost
          defaultActiveKey={normalizedSearchValue || selectedServicesCount > 0 ? [group.companyCode] : []}
          items={[
            {
              key: group.companyCode,
              label: (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, paddingRight: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 16, display: "block", marginBottom: 4 }}>
                      {group.companyLabel}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 13 }}>
                      {translate(
                        "settings.courierPicker.servicesSelected",
                        { selected: selectedServicesCount, total: displayedServices.length },
                        `${selectedServicesCount} of ${displayedServices.length} services enabled`
                      )}
                    </Text>
                  </div>
                  <Tag color={selectedServicesCount > 0 ? "processing" : "default"} style={{ marginInlineEnd: 0 }}>
                    {selectedServicesCount}/{displayedServices.length}
                  </Tag>
                </div>
              ),
              children: (
                <div style={{ padding: "0 16px 16px" }}>
                  {displayedServices.map((service, index) => {
                    const isSelected = hasWildcardSelection || localSelection.has(service.key);
                    return (
                      <div
                        key={service.key}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: 16,
                          padding: "16px 14px",
                          borderRadius: 10,
                          border: `1px solid ${isSelected ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
                          backgroundColor: token.colorBgContainer,
                          marginTop: index === 0 ? 0 : 10,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text strong style={{ fontSize: 15, display: "block", marginBottom: 4 }}>
                            {service.serviceLabel}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
                            {service.description}
                          </Text>
                        </div>
                        <Switch
                          checked={isSelected}
                          disabled={readOnly}
                          onChange={() => handleServiceToggle(service.key)}
                          aria-label={`Toggle ${group.companyLabel} ${service.serviceLabel}`}
                        />
                      </div>
                    );
                  })}
                  {displayedServices.length > 1 && (
                    <div style={{ marginTop: 12, textAlign: "right" }}>
                      <Tag
                        color={allServicesSelected ? "processing" : "default"}
                        style={{ cursor: readOnly ? "not-allowed" : "pointer", marginInlineEnd: 0, opacity: readOnly ? 0.6 : 1 }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (readOnly) {
                            return;
                          }
                          setLocalSelection((prev) => {
                            const next = new Set(prev);
                            next.delete(wildcardSelectionKey);
                            if (allServicesSelected) {
                              displayedServices.forEach((service) => {
                                next.delete(service.key);
                              });
                            } else {
                              displayedServices.forEach((service) => {
                                next.add(service.key);
                              });
                            }
                            return next;
                          });
                        }}
                      >
                        {allServicesSelected
                          ? translate("settings.courierPicker.disableAllServices", {}, "Disable all services")
                          : translate("settings.courierPicker.enableAllServices", {}, "Enable all services")}
                      </Tag>
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    );
  };

  return (
    <Modal
      title={
        <Space direction="vertical" size={0}>
          <Title level={5} style={{ margin: 0 }}>
            {translate("settings.courierPicker.title", {}, "Select Active Couriers")}
          </Title>
          <Text type="secondary" style={{ fontSize: "12px" }}>
            {translate(
              "settings.courierPicker.subtitle",
              { selected: selectedCount, total: totalCount },
              `${selectedCount} of ${totalCount} services selected`
            )}
          </Text>
        </Space>
      }
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      width={640}
      okButtonProps={{ disabled: readOnly }}
      okText={translate("buttons.save", {}, "Save")}
      cancelText={translate("buttons.cancel", {}, "Cancel")}
      destroyOnHidden
      maskClosable={false}
      centered
      styles={{
        body: {
          maxHeight: "calc(100vh - 280px)",
          overflowY: "auto",
          overflowX: "hidden",
        },
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <Space>
          <Tag
            style={{ cursor: "pointer" }}
            color="blue"
            onClick={readOnly ? undefined : handleSelectAll}
          >
            {translate("settings.courierPicker.selectAll", {}, "Select All")}
          </Tag>
          <Tag
            style={{ cursor: readOnly ? "not-allowed" : "pointer", opacity: readOnly ? 0.6 : 1 }}
            onClick={readOnly ? undefined : handleClearAll}
          >
            {translate("settings.courierPicker.clearAll", {}, "Clear All")}
          </Tag>
        </Space>
      </div>

      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          backgroundColor: token.colorBgElevated,
          paddingBottom: 12,
          marginBottom: 16,
        }}
      >
        <Input
          allowClear
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          prefix={<SearchOutlined style={{ color: token.colorTextDescription }} />}
          placeholder={translate(
            "settings.courierPicker.searchPlaceholder",
            {},
            "Search courier or service"
          )}
        />
      </div>

      {error && (
        <div style={{ marginBottom: 16 }}>
          <Text type="danger">
            {translate("settings.courierPicker.loadError", {}, "Failed to load courier list. Using default options.")}
          </Text>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spin />
          <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            {translate("settings.courierPicker.loading", {}, "Loading couriers...")}
          </Text>
        </div>
      ) : couriers.length === 0 ? (
        <Empty
          description={translate("settings.courierPicker.noCouriers", {}, "No couriers available")}
        />
      ) : filteredGroupedCouriers.length === 0 ? (
        <Empty
          description={translate(
            "settings.courierPicker.noSearchResults",
            {},
            "No couriers match your search"
          )}
        />
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
              {translate(
                "settings.courierPicker.description",
                {},
                "Enable courier services that can be offered for shipping rates. Providers like Gojek and Grab can be configured per service."
              )}
            </Text>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredGroupedCouriers.map((group) => renderCourierCard(group))}
          </div>
        </>
      )}
    </Modal>
  );
};

export default CourierPickerModal;
