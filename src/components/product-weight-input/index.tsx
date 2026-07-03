import { InputNumber, Space, Typography, theme } from "antd";

interface ProductWeightInputProps {
  value?: number | null;
  onChange?: (value: number | null) => void;
}

export const ProductWeightInput: React.FC<ProductWeightInputProps> = ({ value, onChange }) => {
  const { token } = theme.useToken();

  return (
    <Space.Compact style={{ width: "100%" }}>
      <InputNumber
        value={value}
        onChange={onChange}
        style={{ width: "100%" }}
        min={1}
        max={20000}
      />
      <Typography.Text
        style={{
          alignItems: "center",
          background: token.colorFillAlter,
          border: `1px solid ${token.colorBorder}`,
          borderLeft: 0,
          borderRadius: `0 ${token.borderRadius}px ${token.borderRadius}px 0`,
          color: token.colorTextSecondary,
          display: "inline-flex",
          padding: "0 11px",
          whiteSpace: "nowrap",
        }}
      >
        gram
      </Typography.Text>
    </Space.Compact>
  );
};
