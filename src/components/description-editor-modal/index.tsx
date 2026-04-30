import { useState } from "react";
import { useTranslation } from "@refinedev/core";
import { Button, Input, Modal, Typography, theme } from "antd";
import { EditOutlined, FileTextOutlined } from "@ant-design/icons";

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface DescriptionEditorModalProps {
  value?: string;
  onChange?: (val: string) => void;
  maxLength?: number;
  label?: string;
}

export const DescriptionEditorModal: React.FC<DescriptionEditorModalProps> = ({
  value,
  onChange,
  maxLength = 5000,
  label,
}) => {
  const { token } = theme.useToken();
  const { translate } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [localValue, setLocalValue] = useState("");

  const handleOpenModal = () => {
    setLocalValue(value ?? "");
    setIsModalOpen(true);
  };

  const handleCancel = () => {
    setIsModalOpen(false);
    setLocalValue("");
  };

  const handleSave = () => {
    onChange?.(localValue);
    setIsModalOpen(false);
  };

  const hasContent = value && value.trim().length > 0;
  const lineCount = value ? value.split("\n").length : 0;
  const previewLines = Math.min(lineCount, 4);

  const previewCardStyle: React.CSSProperties = {
    backgroundColor: token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadius,
    padding: "12px 16px",
    minHeight: hasContent ? "auto" : 80,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    cursor: "pointer",
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  const emptyStateStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    color: token.colorTextTertiary,
    padding: "16px 0",
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOpenModal();
    }
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.style.borderColor = token.colorPrimary;
    target.style.boxShadow = `0 0 0 2px ${token.colorPrimaryBg}`;
  };

  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    target.style.borderColor = token.colorBorderSecondary;
    target.style.boxShadow = "none";
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        style={previewCardStyle}
        onClick={handleOpenModal}
        onKeyDown={handleKeyDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {hasContent ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <FileTextOutlined style={{ color: token.colorTextSecondary, fontSize: 14 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {translate("products.fields.description")}
              </Text>
            </div>
            <Paragraph
              ellipsis={{ rows: previewLines, expandable: false }}
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: token.colorText,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {value}
            </Paragraph>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpenModal();
                }}
              >
                {translate("products.description.editModal.edit", "Edit")}
              </Button>
            </div>
          </>
        ) : (
          <div style={emptyStateStyle}>
            <FileTextOutlined style={{ fontSize: 24, opacity: 0.5 }} />
            <Text type="secondary" style={{ fontSize: 13 }}>
              {label ?? translate("products.description.editModal.emptyState", "No description added yet")}
            </Text>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              style={{ marginTop: 4 }}
            >
              {translate("products.description.editModal.addDescription", "Add description")}
            </Button>
          </div>
        )}
      </div>

      <Modal
        open={isModalOpen}
        title={translate("products.description.editModal.title", "Edit Description")}
        onCancel={handleCancel}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
            <Button key="cancel" onClick={handleCancel}>
              {translate("products.description.editModal.cancel", "Cancel")}
            </Button>
            <Button key="save" type="primary" onClick={handleSave}>
              {translate("products.description.editModal.save", "Save")}
            </Button>
          </div>
        }
        width={720}
        destroyOnHidden
      >
        <div style={{ marginBottom: 24 }}>
          <TextArea
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            rows={12}
            maxLength={maxLength}
            showCount
            autoFocus
            placeholder={translate(
              "products.description.editModal.placeholder",
              "Product description..."
            )}
            style={{ fontSize: 14, lineHeight: 1.6 }}
          />
        </div>
      </Modal>
    </>
  );
};
