-- Generated from D:\office hr\staff name.xlsx
-- Effective month: August 2026

CREATE TABLE IF NOT EXISTS public.salary_import_rows (
  id BIGSERIAL PRIMARY KEY,
  staff_name TEXT NOT NULL,
  monthly_salary NUMERIC(12,2) NOT NULL,
  effective_month TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DELETE FROM public.salary_import_rows
WHERE effective_month = '2026-08';

INSERT INTO public.salary_import_rows (staff_name, monthly_salary, effective_month)
VALUES
('RAVINA BALVIR',7000,'2026-08'),
('SEJAL GEDAM',7000,'2026-08'),
('NATASHA',7000,'2026-08'),
('Rajkumar Walake',8000,'2026-08'),
('Janardhan Motghare',8000,'2026-08'),
('KIRTI MESHRAM',8000,'2026-08'),
('Shubhangi Naik',8000,'2026-08'),
('Priti Sakhare',8000,'2026-08'),
('Manthan',8000,'2026-08'),
('PRIYANKA TEMBURNE',8000,'2026-08'),
('JYOTI',8000,'2026-08'),
('AYUSHI NANDAGAWLI / lokhande',12000,'2026-08'),
('Tejaswini Sharma',9000,'2026-08'),
('Amisha',9000,'2026-08'),
('Vinita',9000,'2026-08'),
('Diksha',9000,'2026-08'),
('Pooja Hirankhede',9000,'2026-08'),
('Bharti',9000,'2026-08'),
('MUSKAN BISEN',9000,'2026-08'),
('Nandini',9000,'2026-08'),
('SHILPA BANKAR',9000,'2026-08'),
('Gumfa Temburne',9000,'2026-08'),
('Urmila Lautkar 9 HOURS',9000,'2026-08'),
('Komal Nagrare',9000,'2026-08'),
('Noor',10000,'2026-08'),
('Anjali sis',10000,'2026-08'),
('Sarita Rangari',10000,'2026-08'),
('Shrutika',15000,'2026-08'),
('Madhuri Gawadi',10000,'2026-08'),
('aarti telang',10000,'2026-08'),
('Uttara Ponikar',13000,'2026-08'),
('Laxmi Wase',10000,'2026-08'),
('Sonam Masih',10000,'2026-08'),
('APEKSHA WANDRE',15000,'2026-08'),
('Kiran Nandanwar',10000,'2026-08'),
('Trupti lab',10000,'2026-08'),
('Sagar Vaidya',10000,'2026-08'),
('Pinki Dhahenwar',10000,'2026-08'),
('Manjusha Koche',11000,'2026-08'),
('Priti Warjukar',10000,'2026-08'),
('VIVEK CHANNE',11000,'2026-08'),
('KASHISH SISTER',11000,'2026-08'),
('PRANAY THAKRE',11000,'2026-08'),
('MAHENDRA BAHE',11000,'2026-08'),
('AJAY MESHRAM',15000,'2026-08'),
('SAGAR BAWANE',12000,'2026-08'),
('Aarti Suryawanshi',12000,'2026-08'),
('KUNAL AKHARE',12000,'2026-08'),
('Meena Yadav',12000,'2026-08'),
('Rima Varade',12000,'2026-08'),
('Shrawan Ingole',12000,'2026-08'),
('Dnyaneshwar Warghane',12000,'2026-08'),
('NIKITA SISTER',12000,'2026-08'),
('SACHIN GODBOLE',12000,'2026-08'),
('Lalita Nishad',12000,'2026-08'),
('VISHAL',13000,'2026-08'),
('KIRAN KADBE',13000,'2026-08'),
('Utkarsha Gajbhiye',13000,'2026-08'),
('Savita Patle',13000,'2026-08'),
('Oshin Tembhurne',13000,'2026-08'),
('RAJAT SURJARE',14000,'2026-08'),
('AFROJ KHAN',14000,'2026-08'),
('TILAK YADAV',15000,'2026-08'),
('SARVESH BRAMHANE',15000,'2026-08'),
('Jiyalal Security Guard',15000,'2026-08'),
('Praful Ambade',15000,'2026-08'),
('PRATIK BROTHER',14000,'2026-08'),
('VIVEK BROTHER',14000,'2026-08'),
('Aarti Dudhabade',15000,'2026-08'),
('Sonali Kakde',15000,'2026-08'),
('Pankaj Shende',15000,'2026-08'),
('Shoibh Sheikh',15000,'2026-08'),
('Abuzar',15000,'2026-08'),
('Harsh Bouncer',15000,'2026-08'),
('Lalit Meshram',20000,'2026-08'),
('SNEHAL TIMANDE',12000,'2026-08'),
('HIMANSHU lokhande',15000,'2026-08'),
('YASH DESHMUKH',15000,'2026-08'),
('Dr. ARUN Agre',15000,'2026-08'),
('Sagar Vaidya',15000,'2026-08'),
('KARTIK MESHRAM',15000,'2026-08'),
('ABHISHEKH KUMAR',15000,'2026-08'),
('AKSHAY',15000,'2026-08'),
('PALAK DONGRE',15000,'2026-08'),
('REHA KHER',15000,'2026-08'),
('ASHRAY SALVE',15000,'2026-08'),
('BHAVIK SHARMA',15000,'2026-08'),
('SONAM',15000,'2026-08'),
('RUCHIKA ZADE',15000,'2026-08'),
('Abhishekh Dannar',15000,'2026-08'),
('Santoshi Patle',16500,'2026-08'),
('Shubham Dubey',17000,'2026-08'),
('Pratik Vyankat',17000,'2026-08'),
('REENA NIRGULE',17000,'2026-08'),
('SHAHNAWAAZ',18000,'2026-08'),
('Azhar Shaik',18000,'2026-08'),
('Rupali Ghumde',18000,'2026-08'),
('ANIRUDDHA',18000,'2026-08'),
('KAUSTUBH HADKE',18000,'2026-08'),
('NITIN DRIVER',18000,'2026-08'),
('Chetna Kurvanshi',18000,'2026-08'),
('SHAILESH GANESH NINAWE',20000,'2026-08'),
('Diksha Sakhare',20000,'2026-08'),
('Nisha Sharma',20000,'2026-08'),
('Pankaj Patel',20000,'2026-08'),
('RUCHIKA JAMBULKAR',20000,'2026-08'),
('Lokeash Ambade',20000,'2026-08'),
('Akshay Barapatre',20000,'2026-08'),
('Digesh Bisen',23000,'2026-08'),
('AZHER KHAN',30000,'2026-08'),
('RIZWANA SHEIKH',25000,'2026-08'),
('Shashank Upgade',25000,'2026-08'),
('Sanjay Khobragade',25000,'2026-08'),
('Bunty Dalne',25000,'2026-08'),
('ARPIT KINARKAR',25000,'2026-08'),
('VIJI MEDAM',25000,'2026-08'),
('ISHITA',25000,'2026-08'),
('ANORA',25000,'2026-08'),
('Mohammad Anas',30000,'2026-08'),
('SAHIL JHA',30000,'2026-08'),
('Ganesh Sharnagat',31000,'2026-08'),
('Aman Rajak',35000,'2026-08'),
('ROMA KUNGAVANI',35000,'2026-08'),
('Suraj Rajput',75000,'2026-08'),
('DR VISHWAJEET RAJPUT',49500,'2026-08'),
('Dr. Shiraz Khan',75000,'2026-08'),
('AMBAR MALIK',20000,'2026-08'),
('RAJESH CHANDRAWANSHI',20000,'2026-08'),
('Baba Khan',15000,'2026-08'),
('Bablu Thakur',15000,'2026-08'),
('Asif',15000,'2026-08'),
('Babla',15000,'2026-08'),
('Vikas',15000,'2026-08'),
('RISHABH',10000,'2026-08');

WITH source AS (
  SELECT DISTINCT ON (LOWER(TRIM(staff_name)))
    staff_name, monthly_salary, effective_month
  FROM public.salary_import_rows
  WHERE effective_month = '2026-08'
  ORDER BY LOWER(TRIM(staff_name)), id DESC
)
INSERT INTO public.salary_configs (employee_id, effective_month, basic_salary)
SELECT e.id, s.effective_month, s.monthly_salary
FROM source s
JOIN public.employees e ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.staff_name))
ON CONFLICT (employee_id, effective_month)
DO UPDATE SET basic_salary = EXCLUDED.basic_salary;

-- Review salary rows whose names did not match employees.
WITH source AS (
  SELECT DISTINCT ON (LOWER(TRIM(staff_name))) staff_name, monthly_salary
  FROM public.salary_import_rows
  WHERE effective_month = '2026-08'
  ORDER BY LOWER(TRIM(staff_name)), id DESC
)
SELECT s.staff_name, s.monthly_salary
FROM source s
LEFT JOIN public.employees e ON LOWER(TRIM(e.name)) = LOWER(TRIM(s.staff_name))
WHERE e.id IS NULL
ORDER BY s.staff_name;
