import { Outlet } from "react-router-dom";

const MainLayout = () => {
  return (
    <section className="@container flex min-h-full w-full flex-col items-center">
      <div className="mx-auto w-full px-[5px] pb-24 pt-3 md:pt-6">
        <Outlet />
      </div>
    </section>
  );
};

export default MainLayout;
